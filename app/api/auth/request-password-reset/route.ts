import { randomInt, createHash, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { sendEmail } from '@/lib/email'

async function ensurePasswordResetTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
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

function generateToken() {
  return String(randomInt(100000, 1000000))
}

export async function POST(request: NextRequest) {
  try {
    await ensurePasswordResetTable()
    const { email } = await request.json()

    if (typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'Informe um e-mail valido' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const [user] = await query<any[]>(
      'SELECT id, nome, email, ativo FROM usuarios WHERE email = ? LIMIT 1',
      [normalizedEmail]
    )

    if (!user || !user.ativo) {
      return NextResponse.json({
        success: true,
        message: 'Se existir uma conta com este e-mail, enviaremos um token de recuperacao.',
      })
    }

    await query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE email = ? AND used_at IS NULL',
      [normalizedEmail]
    )

    const token = generateToken()
    const tokenHash = hashToken(token)
    const id = randomUUID()

    await query(
      `INSERT INTO password_reset_tokens (id, usuario_id, email, token_hash, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [id, user.id, normalizedEmail, tokenHash]
    )

    const appName = process.env.APP_NAME || 'CRM'

    await sendEmail({
      to: normalizedEmail,
      subject: `${appName} - Token de recuperacao de senha`,
      text: `Seu token de recuperacao e ${token}. Ele expira em 15 minutos.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827;">
          <h2>Recuperacao de senha</h2>
          <p>Ola, ${user.nome}.</p>
          <p>Use o token abaixo para redefinir sua senha:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${token}</div>
          <p>Este token expira em 15 minutos e so pode ser usado uma vez.</p>
          <p>Se voce nao solicitou esta recuperacao, ignore este e-mail.</p>
        </div>
      `,
    })

    return NextResponse.json({
      success: true,
      message: 'Se existir uma conta com este e-mail, enviaremos um token de recuperacao.',
    })
  } catch (error: any) {
    console.error('Erro ao solicitar recuperacao de senha:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao solicitar recuperacao de senha' },
      { status: 500 }
    )
  }
}
