import { NextResponse } from 'next/server'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'

export async function POST() {
  try {
    const user = await getAuthenticatedServerUser()

    if (!user?.ativo) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    await ensureSystemDatabaseSchema()

    return NextResponse.json({
      success: true,
      message: 'Schema do banco sincronizado com sucesso',
    })
  } catch (error) {
    console.error('Erro ao sincronizar schema do banco:', error)
    return NextResponse.json(
      { error: 'Erro ao sincronizar schema do banco' },
      { status: 500 }
    )
  }
}
