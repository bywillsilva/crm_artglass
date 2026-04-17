import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { query } from '@/lib/db/mysql'

async function ensureLoginVerificationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS login_verification_tokens (
      id VARCHAR(36) PRIMARY KEY,
      usuario_id VARCHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
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
    await ensureLoginVerificationTable()
    const { challengeId, token } = await request.json()

    if (
      typeof challengeId !== 'string' ||
      typeof token !== 'string' ||
      !challengeId.trim() ||
      !token.trim()
    ) {
      return NextResponse.json({ error: 'Codigo de verificacao invalido' }, { status: 400 })
    }

    const [challenge] = await query<any[]>(
      `SELECT lvt.id, lvt.usuario_id, u.id as user_id, u.nome, u.email, u.avatar, u.role, u.ativo, u.module_permissions
       FROM login_verification_tokens lvt
       INNER JOIN usuarios u ON u.id = lvt.usuario_id
       WHERE lvt.id = ?
         AND lvt.token_hash = ?
         AND lvt.used_at IS NULL
         AND lvt.expires_at > NOW()
       LIMIT 1`,
      [challengeId.trim(), hashToken(token.trim())]
    )

    if (!challenge || !challenge.ativo) {
      return NextResponse.json({ error: 'Codigo invalido ou expirado' }, { status: 400 })
    }

    await query('UPDATE login_verification_tokens SET used_at = NOW() WHERE id = ?', [challenge.id])

    const sessionToken = createSessionToken(challenge.user_id, challenge.role)
    const response = NextResponse.json({
      user: {
        id: challenge.user_id,
        nome: challenge.nome,
        email: challenge.email,
        avatar: challenge.avatar,
        role: challenge.role,
        modulePermissions: challenge.module_permissions,
      },
    })

    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    })

    return response
  } catch (error) {
    console.error('Erro ao validar segundo fator de login:', error)
    return NextResponse.json({ error: 'Erro ao validar codigo de acesso' }, { status: 500 })
  }
}
