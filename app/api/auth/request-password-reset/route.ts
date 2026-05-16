import { randomInt, createHash, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { buildEmailTemplate, sendEmail } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'

async function ensurePasswordResetTable() {
  await prisma.$executeRawUnsafe(`
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
    const user = await prisma.usuarios.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        ativo: true,
      },
    })

    if (!user || !user.ativo) {
      return NextResponse.json({
        success: true,
        message: 'Se existir uma conta com este e-mail, enviaremos um token de recuperacao.',
      })
    }

    await prisma.password_reset_tokens.updateMany({
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
    const id = randomUUID()

    await prisma.password_reset_tokens.create({
      data: {
        id,
        usuario_id: user.id,
        email: normalizedEmail,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    const branding = await getEmailBranding()
    const emailContent = buildEmailTemplate({
      appName: branding.appName,
      title: 'Recuperacao de senha',
      greeting: `Ola, ${user.nome}.`,
      intro: 'Recebemos uma solicitacao para redefinir a sua senha de acesso ao CRM.',
      highlightLabel: 'Codigo de recuperacao',
      highlightValue: token,
      outro: 'Esse codigo expira em 15 minutos e so pode ser usado uma vez.',
      footer: 'Se voce nao solicitou esta recuperacao, pode ignorar este e-mail com seguranca.',
    })

    await sendEmail({
      to: normalizedEmail,
      subject: `${branding.appName} - Token de recuperacao de senha`,
      text: emailContent.text,
      html: emailContent.html,
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
