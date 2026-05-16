import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db/prisma'

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

export async function POST(request: NextRequest) {
  try {
    await ensurePasswordResetTable()
    const { email, token, novaSenha } = await request.json()

    if (
      typeof email !== 'string' ||
      typeof token !== 'string' ||
      typeof novaSenha !== 'string' ||
      !email.trim() ||
      !token.trim() ||
      novaSenha.trim().length < 8
    ) {
      return NextResponse.json({ error: 'Dados invalidos para redefinir senha' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const tokenHash = hashToken(token.trim())

    const resetToken = await prisma.password_reset_tokens.findFirst({
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
        usuario_id: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    })

    if (!resetToken) {
      return NextResponse.json({ error: 'Token invalido ou expirado' }, { status: 400 })
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10)

    await prisma.$transaction([
      prisma.usuarios.update({
        where: {
          id: resetToken.usuario_id,
        },
        data: {
          senha: senhaHash,
        },
      }),
      prisma.password_reset_tokens.update({
        where: {
          id: resetToken.id,
        },
        data: {
          used_at: new Date(),
        },
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao confirmar recuperacao de senha:', error)
    return NextResponse.json({ error: 'Erro ao confirmar recuperacao de senha' }, { status: 500 })
  }
}
