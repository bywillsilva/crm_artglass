import { NextResponse } from 'next/server'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import {
  getSchemaMigrationStatus,
  runPendingSchemaMigrations,
} from '@/lib/server/schema-migrations'

async function requireAdminUser() {
  const user = await getAuthenticatedServerUser()

  if (!user?.ativo) {
    return {
      error: NextResponse.json({ error: 'Nao autenticado' }, { status: 401 }),
      user: null,
    }
  }

  if (user.role !== 'admin') {
    return {
      error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }),
      user: null,
    }
  }

  return { error: null, user }
}

export async function GET() {
  try {
    const auth = await requireAdminUser()
    if (auth.error) {
      return auth.error
    }

    const status = await getSchemaMigrationStatus()

    return NextResponse.json({
      success: true,
      migrations: status,
    })
  } catch (error) {
    console.error('Erro ao consultar status do schema do banco:', error)
    return NextResponse.json(
      { error: 'Erro ao consultar status do schema do banco' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    const auth = await requireAdminUser()
    if (auth.error) {
      return auth.error
    }

    const migrationResult = await runPendingSchemaMigrations()
    const status = await getSchemaMigrationStatus()

    return NextResponse.json({
      success: true,
      message: 'Schema do banco sincronizado com sucesso',
      migrations: {
        ...migrationResult,
        applied: status.applied,
        pending: status.pending,
      },
    })
  } catch (error) {
    console.error('Erro ao sincronizar schema do banco:', error)
    return NextResponse.json(
      { error: 'Erro ao sincronizar schema do banco' },
      { status: 500 }
    )
  }
}
