import { runPendingSchemaMigrations } from '@/lib/server/schema-migrations'

const DATABASE_SCHEMA_CACHE_MS = 60 * 60 * 1000

let systemSchemaCheckedAt = 0
let systemSchemaPromise: Promise<void> | null = null

export async function ensureSystemDatabaseSchema() {
  const now = Date.now()
  if (now - systemSchemaCheckedAt < DATABASE_SCHEMA_CACHE_MS) {
    return
  }

  if (systemSchemaPromise) {
    await systemSchemaPromise
    return
  }

  systemSchemaPromise = (async () => {
    await runPendingSchemaMigrations()
    systemSchemaCheckedAt = Date.now()
  })()

  try {
    await systemSchemaPromise
  } finally {
    systemSchemaPromise = null
  }
}
