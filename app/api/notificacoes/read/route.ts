import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { isTransientDatabaseError, logDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { deleteRuntimeCache, getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const NOTIFICATION_SCHEMA_CACHE_MS = 60 * 60 * 1000
const NOTIFICATION_READS_CACHE_TTL_MS = Math.max(
  Number(process.env.NOTIFICATION_READS_CACHE_TTL_MS || 15_000),
  1000
)
let notificationSchemaCheckedAt = 0
let notificationSchemaPromise: Promise<void> | null = null

function isTransientNotificationDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

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
    await prisma.$executeRawUnsafe(`
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

    const rows = await prisma.notification_reads.findMany({
      where: {
        user_id: user.id,
      },
      select: {
        notification_id: true,
      },
    })

    const payload = rows.map((row) => row.notification_id)
    setRuntimeCache(cacheKey, payload, NOTIFICATION_READS_CACHE_TTL_MS)
    return NextResponse.json(payload)
  } catch (error) {
    logDatabaseError('Erro ao buscar notificacoes lidas', error)
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

    const normalizedNotificationIds = [...new Set(notificationIds.map((notificationId) => String(notificationId)))]
    await prisma.notification_reads.createMany({
      data: normalizedNotificationIds.map((notificationId) => ({
        id: randomUUID(),
        user_id: user.id,
        notification_id: notificationId,
      })),
      skipDuplicates: true,
    })

    deleteRuntimeCache(`notification-reads:${user.id}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logDatabaseError('Erro ao marcar notificacoes como lidas', error)
    if (isTransientNotificationDatabaseError(error)) {
      return NextResponse.json({ success: true, degraded: true })
    }
    return NextResponse.json({ error: 'Erro ao marcar notificacoes como lidas' }, { status: 500 })
  }
}
