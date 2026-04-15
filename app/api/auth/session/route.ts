import { NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { clearSessionCookie, getServerSession } from '@/lib/auth/session'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'

export async function GET() {
  try {
    await ensureUserManagementSchema()
    const session = await getServerSession()
    if (!session) {
      const response = NextResponse.json({ user: null }, { status: 401 })
      clearSessionCookie(response)
      return response
    }

    const [user] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo, module_permissions FROM usuarios WHERE id = ? LIMIT 1',
      [session.userId]
    )

    if (!user || !user.ativo) {
      const response = NextResponse.json({ user: null }, { status: 401 })
      clearSessionCookie(response)
      return response
    }

    return NextResponse.json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        ativo: user.ativo,
        modulePermissions: user.module_permissions,
      },
    })
  } catch (error) {
    console.error('Erro ao carregar sessao:', error)
    return NextResponse.json({ error: 'Erro ao carregar sessao' }, { status: 500 })
  }
}
