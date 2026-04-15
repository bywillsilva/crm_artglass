import { NextResponse } from 'next/server'
import {
  clearSessionCookie,
  getAuthenticatedServerUser,
  getServerSession,
} from '@/lib/auth/session'

export async function GET() {
  const session = await getServerSession()

  try {
    if (!session) {
      const response = NextResponse.json({ user: null }, { status: 401 })
      clearSessionCookie(response)
      return response
    }

    const user = await getAuthenticatedServerUser()
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
        modulePermissions: user.modulePermissions,
      },
    })
  } catch (error) {
    console.error('Erro ao carregar sessao:', error)

    if (session) {
      return NextResponse.json({
        user: {
          id: session.userId,
          nome: '',
          email: '',
          avatar: '',
          role: session.role,
          ativo: true,
          modulePermissions: null,
        },
        degraded: true,
      })
    }

    return NextResponse.json({ error: 'Erro ao carregar sessao' }, { status: 500 })
  }
}
