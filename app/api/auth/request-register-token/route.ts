import { createHash, randomInt, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'
import { sendEmail } from '@/lib/email'

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

function generateToken() {
  return String(randomInt(100000, 1000000))
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    await ensureEmailVerificationTable()
    const { nome, email, senha } = await request.json()

    if (
      typeof nome !== 'string' ||
      typeof email !== 'string' ||
      typeof senha !== 'string' ||
      !nome.trim() ||
      !email.trim() ||
      senha.trim().length < 8
    ) {
      return NextResponse.json(
        { error: 'Nome, email e senha valida de no minimo 8 caracteres sao obrigatorios' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    const [existingUser] = await query<any[]>(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [normalizedEmail]
    )

    if (existingUser) {
      return NextResponse.json({ error: 'Ja existe uma conta vinculada a este email' }, { status: 400 })
    }

    await query(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE email = ? AND used_at IS NULL',
      [normalizedEmail]
    )

    const token = generateToken()
    const tokenHash = hashToken(token)
    const senhaHash = await bcrypt.hash(senha, 10)

    await query(
      `INSERT INTO email_verification_tokens (id, nome, email, senha_hash, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [randomUUID(), nome.trim(), normalizedEmail, senhaHash, tokenHash]
    )

    const appName = process.env.APP_NAME || 'Sistema CRM'
    await sendEmail({
      to: normalizedEmail,
      subject: `${appName} - Confirmacao de cadastro`,
      text: `Seu token de confirmacao de cadastro e ${token}. Ele expira em 15 minutos.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827;">
          <h2>Confirmacao de cadastro</h2>
          <p>Use o token abaixo para confirmar a criacao da sua conta:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0;">${token}</div>
          <p>Este token expira em 15 minutos e so pode ser usado uma vez.</p>
        </div>
      `,
    })

    return NextResponse.json({
      success: true,
      message: 'Enviamos um token de confirmacao para o e-mail informado.',
    })
  } catch (error: any) {
    console.error('Erro ao solicitar token de cadastro:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao solicitar token de cadastro' },
      { status: 500 }
    )
  }
}
