import { isTransientDatabaseError, logDatabaseError, query } from '@/lib/db/mysql'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'

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
    logDatabaseError('Erro ao garantir schema de sincronizacao', error)
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
      const [row] = await query<any[]>(
        `SELECT COALESCE(MAX(id), 0) as version
         FROM realtime_updates`
      )

      realtimeVersion = Number(row?.version || 0)
      realtimeVersionCachedAt = Date.now()
      return realtimeVersion
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
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
    logDatabaseError('Erro ao garantir schema de sincronizacao por modulo', error)
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
      const rows = await query<any[]>(
        `SELECT resource, COALESCE(MAX(id), 0) as version, MAX(created_at) as changed_at
         FROM realtime_updates
         GROUP BY resource`
      )

      const nextVersions: Record<string, number> = {}
      const nextChangedAt: Record<string, string> = {}

      for (const row of rows) {
        const version = Number(row?.version || 0)
        if (!Number.isFinite(version) || version <= 0) {
          continue
        }

        const moduleKey = mapResourceToModule(String(row?.resource || ''))
        const currentVersion = nextVersions[moduleKey] || 0
        if (version > currentVersion) {
          nextVersions[moduleKey] = version
          nextChangedAt[moduleKey] = String(row?.changed_at || '')
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
      if (!isTransientDatabaseError(error)) {
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
