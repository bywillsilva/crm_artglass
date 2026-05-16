import { createHash, randomInt, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'
import { buildEmailTemplate, sendEmail } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'

async function ensureEmailVerificationTable() {
  await prisma.$executeRawUnsafe(`
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
    const existingUser = await prisma.usuarios.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
      },
    })

    if (existingUser) {
      return NextResponse.json({ error: 'Ja existe uma conta vinculada a este email' }, { status: 400 })
    }

    await prisma.email_verification_tokens.updateMany({
      where: {
        email: normalizedEmail,
        used_at: null,
      },
      data: {
        used_at: new Date(),
      },
    })

    const token = generateToken()
    const tokenHash = hashToken(token)
    const senhaHash = await bcrypt.hash(senha, 10)

    await prisma.email_verification_tokens.create({
      data: {
        id: randomUUID(),
        nome: nome.trim(),
        email: normalizedEmail,
        senha_hash: senhaHash,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    const branding = await getEmailBranding()
    const emailContent = buildEmailTemplate({
      appName: branding.appName,
      title: 'Confirmacao de cadastro',
      greeting: `Ola, ${nome.trim()}.`,
      intro: 'Use o codigo abaixo para confirmar a criacao da sua conta no CRM.',
      highlightLabel: 'Codigo de confirmacao',
      highlightValue: token,
      outro: 'Esse codigo expira em 15 minutos e so pode ser usado uma vez.',
    })

    await sendEmail({
      to: normalizedEmail,
      subject: `${branding.appName} - Confirmacao de cadastro`,
      text: emailContent.text,
      html: emailContent.html,
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
