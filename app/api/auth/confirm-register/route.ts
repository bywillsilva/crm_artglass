import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

async function ensureEmailVerificationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id VARCHAR(36) PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    await ensureEmailVerificationTable()
    const { email, token } = await request.json()

    if (
      typeof email !== 'string' ||
      typeof token !== 'string' ||
      !email.trim() ||
      !token.trim()
    ) {
      return NextResponse.json({ error: 'Email e token sao obrigatorios' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const tokenHash = hashToken(token.trim())

    const [existingUser] = await query<any[]>(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [normalizedEmail]
    )

    if (existingUser) {
      return NextResponse.json({ error: 'Ja existe uma conta vinculada a este email' }, { status: 400 })
    }

    const [pendingRegistration] = await query<any[]>(
      `SELECT *
       FROM email_verification_tokens
       WHERE email = ?
         AND token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedEmail, tokenHash]
    )

    if (!pendingRegistration) {
      return NextResponse.json({ error: 'Token invalido ou expirado' }, { status: 400 })
    }

    const [usersCount] = await query<any[]>('SELECT COUNT(*) as total FROM usuarios')
    const role = usersCount.total === 0 ? 'admin' : 'vendedor'
    const id = uuidv4()
    const avatar = pendingRegistration.nome
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((parte: string) => parte[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    await query(
      `INSERT INTO usuarios (id, nome, email, senha, avatar, role, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, pendingRegistration.nome, normalizedEmail, pendingRegistration.senha_hash, avatar, role, true]
    )

    await query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?', [
      pendingRegistration.id,
    ])

    const authToken = createSessionToken(id, role)
    const response = NextResponse.json({
      user: {
        id,
        nome: pendingRegistration.nome,
        email: normalizedEmail,
        avatar,
        role,
      },
    })

    response.cookies.set(SESSION_COOKIE, authToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    })

    return response
  } catch (error: any) {
    console.error('Erro ao confirmar cadastro:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Ja existe uma conta vinculada a este email' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao confirmar cadastro' }, { status: 500 })
  }
}
