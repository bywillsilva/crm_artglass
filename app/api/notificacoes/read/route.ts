import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { query } from '@/lib/db/mysql'
import { deleteRuntimeCache, getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const NOTIFICATION_SCHEMA_CACHE_MS = 60 * 60 * 1000
const NOTIFICATION_READS_CACHE_TTL_MS = Math.max(
  Number(process.env.NOTIFICATION_READS_CACHE_TTL_MS || 15_000),
  1000
)
let notificationSchemaCheckedAt = 0
let notificationSchemaPromise: Promise<void> | null = null

async function ensureReadNotificationsTable() {
  const now = Date.now()
  if (now - notificationSchemaCheckedAt < NOTIFICATION_SCHEMA_CACHE_MS) {
    return
  }

  if (notificationSchemaPromise) {
    await notificationSchemaPromise
    return
  }

  notificationSchemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        notification_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_notification (user_id, notification_id)
      )
    `)

    notificationSchemaCheckedAt = Date.now()
  })()

  try {
    await notificationSchemaPromise
  } finally {
    notificationSchemaPromise = null
  }
}

export async function GET() {
  try {
    const user = await getAuthenticatedServerUser()

    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `notification-reads:${user.id}`
    const cachedNotifications = getRuntimeCache<string[]>(cacheKey)
    if (cachedNotifications !== undefined) {
      return NextResponse.json(cachedNotifications)
    }

    const rows = await query<any[]>(
      'SELECT notification_id FROM notification_reads WHERE user_id = ?',
      [user.id]
    )

    const payload = rows.map((row) => row.notification_id)
    setRuntimeCache(cacheKey, payload, NOTIFICATION_READS_CACHE_TTL_MS)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Erro ao buscar notificacoes lidas:', error)
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureReadNotificationsTable()
    const user = await getAuthenticatedServerUser()

    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { notificationIds } = await request.json()
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ error: 'Nenhuma notificacao informada' }, { status: 400 })
    }

    for (const notificationId of notificationIds) {
      await query(
        'INSERT IGNORE INTO notification_reads (id, user_id, notification_id) VALUES (UUID(), ?, ?)',
        [user.id, String(notificationId)]
      )
    }

    deleteRuntimeCache(`notification-reads:${user.id}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao marcar notificacoes como lidas:', error)
    return NextResponse.json({ error: 'Erro ao marcar notificacoes como lidas' }, { status: 500 })
  }
}
