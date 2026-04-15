import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getLatestRealtimeVersion } from '@/lib/server/realtime-events'

export async function GET() {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const version = await getLatestRealtimeVersion()
    return NextResponse.json({ version })
  } catch (error) {
    console.error('Erro ao buscar versao de sincronizacao:', error)
    return NextResponse.json({ error: 'Erro ao buscar versao de sincronizacao' }, { status: 500 })
  }
}
