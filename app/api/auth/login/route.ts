import { createHash, randomInt, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { buildEmailTemplate } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'
import { safeSendEmail, userHasTwoFactorEnabled } from '@/lib/server/user-settings'

function generateToken() {
  return String(randomInt(100000, 1000000))
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return email

  if (localPart.length <= 2) {
    return `${localPart[0] || '*'}***@${domain}`
  }

  return `${localPart.slice(0, 2)}***@${domain}`
}

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

export async function POST(request: NextRequest) {
  try {
    await ensureUserManagementSchema()
    const { email, senha } = await request.json()

    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha sao obrigatorios' }, { status: 400 })
    }

    const [user] = await query<any[]>(
      'SELECT id, nome, email, senha, avatar, role, ativo, module_permissions FROM usuarios WHERE email = ? LIMIT 1',
      [email]
    )

    if (!user) {
      return NextResponse.json({ error: 'Credenciais invalidas' }, { status: 401 })
    }

    if (!user.ativo) {
      return NextResponse.json({ error: 'Usuario inativo' }, { status: 403 })
    }

    const isValid = await bcrypt.compare(senha, user.senha)
    if (!isValid) {
      return NextResponse.json({ error: 'Credenciais invalidas' }, { status: 401 })
    }

    const requiresTwoFactor = await userHasTwoFactorEnabled(user.id)

    if (requiresTwoFactor) {
      await ensureLoginVerificationTable()
      await query(
        'UPDATE login_verification_tokens SET used_at = NOW() WHERE usuario_id = ? AND used_at IS NULL',
        [user.id]
      )

      const challengeId = randomUUID()
      const code = generateToken()

      await query(
        `INSERT INTO login_verification_tokens (id, usuario_id, email, token_hash, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [challengeId, user.id, user.email, hashToken(code)]
      )

      const branding = await getEmailBranding()
      const emailContent = buildEmailTemplate({
        appName: branding.appName,
        title: 'Verificacao em duas etapas',
        greeting: `Ola, ${user.nome}.`,
        intro: 'Use o codigo abaixo para concluir o seu acesso ao CRM.',
        highlightLabel: 'Codigo de verificacao',
        highlightValue: code,
        outro: 'Esse codigo expira em 10 minutos e so pode ser usado uma vez.',
      })

      const emailSent = await safeSendEmail({
        to: user.email,
        subject: `${branding.appName} - Codigo de verificacao de acesso`,
        text: emailContent.text,
        html: emailContent.html,
      })

      if (!emailSent) {
        return NextResponse.json(
          { error: 'Nao foi possivel enviar o codigo de verificacao por e-mail.' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        requiresTwoFactor: true,
        challengeId,
        emailMask: maskEmail(user.email),
      })
    }

    const token = createSessionToken(user.id, user.role)
    const response = NextResponse.json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        modulePermissions: user.module_permissions,
      },
    })

    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    })

    return response
  } catch (error) {
    console.error('Erro ao autenticar usuario:', error)
    return NextResponse.json({ error: 'Erro ao autenticar usuario' }, { status: 500 })
  }
}
