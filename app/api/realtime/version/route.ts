import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import {
  getLatestRealtimeVersion,
  getLatestRealtimeVersionsByModule,
} from '@/lib/server/realtime-events'

export async function GET() {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Nao autenticado' },
        {
          status: 401,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        }
      )
    }

    const [version, moduleRealtime] = await Promise.all([
      getLatestRealtimeVersion(),
      getLatestRealtimeVersionsByModule(),
    ])
    return NextResponse.json(
      {
        version,
        versions: moduleRealtime.versions,
        changedAt: moduleRealtime.changedAt,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    )
  } catch (error) {
    console.error('Erro ao buscar versao de sincronizacao:', error)
    return NextResponse.json(
      { version: 0, versions: {}, changedAt: {}, degraded: true },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    )
  }
}
