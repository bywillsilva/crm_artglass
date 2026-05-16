import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/db/prisma'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'

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

    const pendingRegistration = await prisma.email_verification_tokens.findFirst({
      where: {
        email: normalizedEmail,
        token_hash: tokenHash,
        used_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        nome: true,
        email: true,
        senha_hash: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    })

    if (!pendingRegistration) {
      return NextResponse.json({ error: 'Token invalido ou expirado' }, { status: 400 })
    }

    const usersCount = await prisma.usuarios.count()
    const role = usersCount === 0 ? 'admin' : 'vendedor'
    const id = uuidv4()
    const avatar = pendingRegistration.nome
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((parte: string) => parte[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    await prisma.$transaction([
      prisma.usuarios.create({
        data: {
          id,
          nome: pendingRegistration.nome,
          email: normalizedEmail,
          senha: pendingRegistration.senha_hash,
          avatar,
          role,
          ativo: true,
        },
      }),
      prisma.email_verification_tokens.update({
        where: {
          id: pendingRegistration.id,
        },
        data: {
          used_at: new Date(),
        },
      }),
    ])

    await publishRealtimeEvent({
      actorUserId: id,
      resource: 'usuario',
      resourceId: id,
    })

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
    if (error.code === 'ER_DUP_ENTRY' || error.code === 'P2002') {
      return NextResponse.json({ error: 'Ja existe uma conta vinculada a este email' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao confirmar cadastro' }, { status: 500 })
  }
}
