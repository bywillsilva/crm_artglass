import { NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'

export async function GET() {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    const [user] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
      [session.userId]
    )

    if (!user || !user.ativo) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        ativo: user.ativo,
      },
    })
  } catch (error) {
    console.error('Erro ao carregar sessao:', error)
    return NextResponse.json({ error: 'Erro ao carregar sessao' }, { status: 500 })
  }
}
