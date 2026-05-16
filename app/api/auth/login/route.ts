import { createHash, randomInt, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { buildEmailTemplate } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'
import { safeSendEmail, userHasTwoFactorEnabled } from '@/lib/server/user-settings'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'

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

function isTransientLoginDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

async function ensureLoginVerificationTable() {
  await prisma.$executeRawUnsafe(`
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
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'local'
    const { email, senha } = await request.json()

    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha sao obrigatorios' }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const rateLimit = await checkRateLimit({
      key: `login:${clientIp}:${normalizedEmail}`,
      limit: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
      windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
    })

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login. Tente novamente em alguns instantes.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          },
        }
      )
    }

    const user = await prisma.usuarios.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        senha: true,
        avatar: true,
        role: true,
        ativo: true,
        module_permissions: true,
        rule_permissions: true,
      },
    })

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
      await prisma.login_verification_tokens.updateMany({
        where: {
          usuario_id: user.id,
          used_at: null,
        },
        data: {
          used_at: new Date(),
        },
      })

      const challengeId = randomUUID()
      const code = generateToken()

      await prisma.login_verification_tokens.create({
        data: {
          id: challengeId,
          usuario_id: user.id,
          email: user.email,
          token_hash: hashToken(code),
          expires_at: new Date(Date.now() + 10 * 60 * 1000),
        },
      })

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
    const role = user.role as RoleUsuario
    const response = NextResponse.json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        modulePermissions: normalizeModulePermissions(user.module_permissions ?? null, role),
        rulePermissions: normalizeRulePermissions(user.rule_permissions ?? null, role),
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
    if (isTransientLoginDatabaseError(error)) {
      return NextResponse.json(
        { error: 'Banco temporariamente indisponivel. Tente novamente em alguns instantes.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: 'Erro ao autenticar usuario' }, { status: 500 })
  }
}
