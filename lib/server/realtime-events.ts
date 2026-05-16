import { isTransientDatabaseError, logDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'

const REALTIME_SCHEMA_CACHE_MS = 60 * 60 * 1000
const REALTIME_VERSION_CACHE_MS = Math.max(
  Number(process.env.REALTIME_VERSION_CACHE_MS || 2000),
  1000
)
const REALTIME_SCHEMA_RETRY_BACKOFF_MS = Math.max(
  Number(process.env.REALTIME_SCHEMA_RETRY_BACKOFF_MS || 30000),
  5000
)

let realtimeSchemaCheckedAt = 0
let realtimeSchemaPromise: Promise<void> | null = null
let realtimeSchemaRetryAt = 0
let realtimeVersion = 0
let realtimeVersionCachedAt = 0
let realtimeVersionPromise: Promise<number> | null = null
let realtimeModuleVersions: Record<string, number> = {}
let realtimeModuleChangedAt: Record<string, string> = {}
let realtimeModuleVersionsCachedAt = 0
let realtimeModuleVersionsPromise: Promise<{
  versions: Record<string, number>
  changedAt: Record<string, string>
}> | null = null

type PublishRealtimeEventParams = {
  actorUserId?: string | null
  resource: string
  resourceId?: string | null
}

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

function isTransientRealtimeDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function mapResourceToModule(resource: string) {
  switch (resource) {
    case 'cliente':
      return 'clientes'
    case 'usuario':
      return 'usuarios'
    case 'tarefa':
      return 'tarefas'
    case 'proposta':
    case 'proposta_anexo':
    case 'proposta_comentario':
      return 'propostas'
    case 'interacao':
      return 'interacoes'
    case 'configuracao':
    case 'config_global':
    case 'config_usuario':
      return 'configuracoes'
    default:
      return 'global'
  }
}

export async function ensureRealtimeEventsSchema() {
  const now = Date.now()
  if (now - realtimeSchemaCheckedAt < REALTIME_SCHEMA_CACHE_MS) {
    return
  }

  if (now < realtimeSchemaRetryAt) {
    const error = new Error('Schema de sincronizacao temporariamente indisponivel')
    ;(error as Error & { code?: string }).code = 'DB_UNAVAILABLE'
    throw error
  }

  if (realtimeSchemaPromise) {
    await realtimeSchemaPromise
    return
  }

  realtimeSchemaPromise = (async () => {
    try {
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
      realtimeSchemaRetryAt = 0
    } catch (error) {
      if (isTransientDatabaseError(error)) {
        realtimeSchemaRetryAt = Date.now() + REALTIME_SCHEMA_RETRY_BACKOFF_MS
      }
      throw error
    }
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

    const result = await prisma.realtime_updates.create({
      data: {
        actor_user_id: actorUserId || null,
        resource,
        resource_id: resourceId || null,
      },
      select: {
        id: true,
      },
    })

    const insertedId = Number(result?.id || 0)
    if (insertedId > 0) {
      realtimeVersion = insertedId
      realtimeVersionCachedAt = Date.now()
      const moduleKey = mapResourceToModule(resource)
      realtimeModuleVersions = {
        ...realtimeModuleVersions,
        [moduleKey]: insertedId,
      }
      realtimeModuleChangedAt = {
        ...realtimeModuleChangedAt,
        [moduleKey]: new Date().toISOString(),
      }
      realtimeModuleVersionsCachedAt = Date.now()
      invalidateRuntimeCache()
    }
  } catch (error) {
    logDatabaseError('Erro ao publicar evento de sincronizacao em tempo real', error)
  }
}

export async function getLatestRealtimeVersion() {
  try {
    await ensureRealtimeEventsSchema()
  } catch (error) {
    if (!isTransientRealtimeDatabaseError(error)) {
      logDatabaseError('Erro ao garantir schema de sincronizacao', error)
    }
    return realtimeVersion
  }

  const now = Date.now()
  if (now - realtimeVersionCachedAt < REALTIME_VERSION_CACHE_MS) {
    return realtimeVersion
  }

  if (realtimeVersionPromise) {
    return realtimeVersionPromise
  }

  realtimeVersionPromise = (async () => {
    try {
      const row = await prisma.realtime_updates.aggregate({
        _max: {
          id: true,
        },
      })

      realtimeVersion = Number(row._max.id || 0)
      realtimeVersionCachedAt = Date.now()
      return realtimeVersion
    } catch (error) {
      if (!isTransientRealtimeDatabaseError(error)) {
        logDatabaseError('Erro ao consultar versao de sincronizacao', error)
      }
      return realtimeVersion
    }
  })()

  try {
    return await realtimeVersionPromise
  } finally {
    realtimeVersionPromise = null
  }
}

export async function getLatestRealtimeVersionsByModule() {
  try {
    await ensureRealtimeEventsSchema()
  } catch (error) {
    if (!isTransientRealtimeDatabaseError(error)) {
      logDatabaseError('Erro ao garantir schema de sincronizacao por modulo', error)
    }
    return {
      versions: realtimeModuleVersions,
      changedAt: realtimeModuleChangedAt,
    }
  }

  const now = Date.now()
  if (now - realtimeModuleVersionsCachedAt < REALTIME_VERSION_CACHE_MS) {
    return {
      versions: realtimeModuleVersions,
      changedAt: realtimeModuleChangedAt,
    }
  }

  if (realtimeModuleVersionsPromise) {
    return realtimeModuleVersionsPromise
  }

  realtimeModuleVersionsPromise = (async () => {
    try {
      const rows = await prisma.realtime_updates.groupBy({
        by: ['resource'],
        _max: {
          id: true,
          created_at: true,
        },
      })

      const nextVersions: Record<string, number> = {}
      const nextChangedAt: Record<string, string> = {}

      for (const row of rows) {
        const version = Number(row._max.id || 0)
        if (!Number.isFinite(version) || version <= 0) {
          continue
        }

        const moduleKey = mapResourceToModule(String(row.resource || ''))
        const currentVersion = nextVersions[moduleKey] || 0
        if (version > currentVersion) {
          nextVersions[moduleKey] = version
          nextChangedAt[moduleKey] = row._max.created_at?.toISOString() || ''
        }
      }

      realtimeModuleVersions = nextVersions
      realtimeModuleChangedAt = nextChangedAt
      realtimeModuleVersionsCachedAt = Date.now()
      return {
        versions: realtimeModuleVersions,
        changedAt: realtimeModuleChangedAt,
      }
    } catch (error) {
      if (!isTransientRealtimeDatabaseError(error)) {
        logDatabaseError('Erro ao consultar versoes de sincronizacao por modulo', error)
      }
      return {
        versions: realtimeModuleVersions,
        changedAt: realtimeModuleChangedAt,
      }
    }
  })()

  try {
    return await realtimeModuleVersionsPromise
  } finally {
    realtimeModuleVersionsPromise = null
  }
}
