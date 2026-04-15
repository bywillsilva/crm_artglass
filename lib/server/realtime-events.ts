import { query } from '@/lib/db/mysql'

const REALTIME_SCHEMA_CACHE_MS = 60 * 60 * 1000
const REALTIME_VERSION_CACHE_MS = Math.max(
  Number(process.env.REALTIME_VERSION_CACHE_MS || 5000),
  1000
)

let realtimeSchemaCheckedAt = 0
let realtimeSchemaPromise: Promise<void> | null = null
let realtimeVersion = 0
let realtimeVersionCachedAt = 0
let realtimeVersionPromise: Promise<number> | null = null

type PublishRealtimeEventParams = {
  actorUserId?: string | null
  resource: string
  resourceId?: string | null
}

export async function ensureRealtimeEventsSchema() {
  const now = Date.now()
  if (now - realtimeSchemaCheckedAt < REALTIME_SCHEMA_CACHE_MS) {
    return
  }

  if (realtimeSchemaPromise) {
    await realtimeSchemaPromise
    return
  }

  realtimeSchemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS realtime_updates (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_user_id VARCHAR(36) NULL,
        resource VARCHAR(50) NOT NULL,
        resource_id VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_realtime_updates_created_id (created_at, id)
      )
    `)

    realtimeSchemaCheckedAt = Date.now()
  })()

  try {
    await realtimeSchemaPromise
  } finally {
    realtimeSchemaPromise = null
  }
}

export async function publishRealtimeEvent({
  actorUserId,
  resource,
  resourceId,
}: PublishRealtimeEventParams) {
  try {
    await ensureRealtimeEventsSchema()

    const result = await query<any>(
      `INSERT INTO realtime_updates (actor_user_id, resource, resource_id)
       VALUES (?, ?, ?)`,
      [actorUserId || null, resource, resourceId || null]
    )

    const insertedId = Number(result?.insertId || 0)
    if (insertedId > 0) {
      realtimeVersion = insertedId
      realtimeVersionCachedAt = Date.now()
    }
  } catch (error) {
    console.error('Erro ao publicar evento de sincronizacao em tempo real:', error)
  }
}

export async function getLatestRealtimeVersion() {
  await ensureRealtimeEventsSchema()

  const now = Date.now()
  if (now - realtimeVersionCachedAt < REALTIME_VERSION_CACHE_MS) {
    return realtimeVersion
  }

  if (realtimeVersionPromise) {
    return realtimeVersionPromise
  }

  realtimeVersionPromise = (async () => {
    const [row] = await query<any[]>(
      `SELECT COALESCE(MAX(id), 0) as version
       FROM realtime_updates`
    )

    realtimeVersion = Number(row?.version || 0)
    realtimeVersionCachedAt = Date.now()
    return realtimeVersion
  })()

  try {
    return await realtimeVersionPromise
  } finally {
    realtimeVersionPromise = null
  }
}
