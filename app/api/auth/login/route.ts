import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'

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
