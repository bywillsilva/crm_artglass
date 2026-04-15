import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { query } from '@/lib/db/mysql'

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getAuthenticatedServerUser()

    if (!sessionUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 })
    }

    if (newPassword.trim().length < 8) {
      return NextResponse.json(
        { error: 'A nova senha deve ter no minimo 8 caracteres' },
        { status: 400 }
      )
    }

    const [user] = await query<any[]>(
      'SELECT id, senha FROM usuarios WHERE id = ? LIMIT 1',
      [sessionUser.id]
    )

    if (!user) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    const isValid = await bcrypt.compare(currentPassword, user.senha)
    if (!isValid) {
      return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
    }

    const senhaHash = await bcrypt.hash(newPassword, 10)
    await query('UPDATE usuarios SET senha = ? WHERE id = ?', [senhaHash, sessionUser.id])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao alterar senha:', error)
    return NextResponse.json({ error: 'Erro ao alterar senha' }, { status: 500 })
  }
}
