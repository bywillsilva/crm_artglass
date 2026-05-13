import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { syncDueFollowUpStatuses } from '@/lib/server/proposal-workflow'

const SCHEMA_READY_CACHE_KEY = 'maintenance:schema-ready'
const FOLLOW_UP_SYNC_CACHE_KEY = 'maintenance:follow-up-sync'

const SCHEMA_READY_TTL_MS = Math.max(
  Number(process.env.SCHEMA_READY_TTL_MS || 5 * 60_000),
  10_000
)
const FOLLOW_UP_SYNC_TTL_MS = Math.max(
  Number(process.env.FOLLOW_UP_SYNC_TTL_MS || 30_000),
  5_000
)

let schemaReadyPromise: Promise<void> | null = null
let followUpSyncPromise: Promise<void> | null = null

async function runSingleFlight(
  key: string,
  ttlMs: number,
  currentPromise: Promise<void> | null,
  setPromise: (value: Promise<void> | null) => void,
  action: () => Promise<void>
) {
  const cached = getRuntimeCache<boolean>(key)
  if (cached) {
    return
  }

  if (currentPromise) {
    await currentPromise
    return
  }

  const nextPromise = (async () => {
    await action()
    setRuntimeCache(key, true, ttlMs)
  })()

  setPromise(nextPromise)

  try {
    await nextPromise
  } finally {
    setPromise(null)
  }
}

export async function ensureSchemaReadyForReads() {
  await runSingleFlight(
    SCHEMA_READY_CACHE_KEY,
    SCHEMA_READY_TTL_MS,
    schemaReadyPromise,
    (value) => {
      schemaReadyPromise = value
    },
    ensureSystemDatabaseSchema
  )
}

export async function ensureProposalReadSideReady() {
  await runSingleFlight(
    FOLLOW_UP_SYNC_CACHE_KEY,
    FOLLOW_UP_SYNC_TTL_MS,
    followUpSyncPromise,
    (value) => {
      followUpSyncPromise = value
    },
    syncDueFollowUpStatuses
  )
}
