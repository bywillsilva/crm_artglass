import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { query } from '@/lib/db/mysql'

function ensureDevelopmentMode() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Not found')
  }
}

export async function GET(request: NextRequest) {
  try {
    ensureDevelopmentMode()

    const userId = request.nextUrl.searchParams.get('userId')
    const role = request.nextUrl.searchParams.get('role')
    const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/funil'

    if (!userId || !role) {
      return NextResponse.json({ error: 'userId e role sao obrigatorios' }, { status: 400 })
    }

    const [user] = await query<any[]>(
      `SELECT id, role, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [userId]
    )

    if (!user || !user.ativo || user.role !== role) {
      return NextResponse.json({ error: 'Usuario invalido para impersonacao' }, { status: 404 })
    }

    const response = NextResponse.redirect(new URL(redirectTo, request.url))
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id, user.role), {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 60,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.message === 'Not found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    console.error('Erro ao impersonar usuario temporario de teste:', error)
    return NextResponse.json({ error: 'Erro ao impersonar usuario de teste' }, { status: 500 })
  }
}
