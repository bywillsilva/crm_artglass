import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'

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

    const [resetToken] = await query<any[]>(
      `SELECT id, usuario_id
       FROM password_reset_tokens
       WHERE email = ?
         AND token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedEmail, tokenHash]
    )

    if (!resetToken) {
      return NextResponse.json({ error: 'Token invalido ou expirado' }, { status: 400 })
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10)

    await query('UPDATE usuarios SET senha = ? WHERE id = ?', [senhaHash, resetToken.usuario_id])
    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [resetToken.id])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao confirmar recuperacao de senha:', error)
    return NextResponse.json({ error: 'Erro ao confirmar recuperacao de senha' }, { status: 500 })
  }
}
