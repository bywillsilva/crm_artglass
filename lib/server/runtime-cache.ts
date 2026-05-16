import { getRedisKey, safeRedisOperation } from '@/lib/server/redis'
import { normalizeJsonPayload } from '@/lib/server/json-normalize'

type RuntimeCacheEntry<T> = {
  version: number
  value: T
  expiresAt: number
  staleExpiresAt: number
  lastAccessedAt: number
}

const runtimeCache = new Map<string, RuntimeCacheEntry<unknown>>()
const CACHE_FORMAT_VERSION = 2
const CACHE_INDEX_KEY = 'runtime-cache:index'
const CACHE_MAX_ENTRIES = Math.max(Number(process.env.RUNTIME_CACHE_MAX_ENTRIES || 1000), 100)
const CACHE_STALE_GRACE_MS = Math.max(Number(process.env.RUNTIME_CACHE_STALE_GRACE_MS || 30_000), 0)
const redisWarmupsInFlight = new Set<string>()

function normalizePrefix(prefix?: string) {
  return prefix || '*'
}

function serializeCacheValue<T>(value: T, ttlMs: number) {
  const now = Date.now()
  return JSON.stringify({
    version: CACHE_FORMAT_VERSION,
    value: normalizeJsonPayload(value),
    expiresAt: now + Math.max(ttlMs, 1),
    staleExpiresAt: now + Math.max(ttlMs, 1) + CACHE_STALE_GRACE_MS,
    lastAccessedAt: now,
  })
}

function hydrateRuntimeCache<T>(key: string, serialized: string | null) {
  if (!serialized) {
    return
  }

  try {
    const parsed = JSON.parse(serialized) as RuntimeCacheEntry<T>
    if (!parsed || parsed.version !== CACHE_FORMAT_VERSION || parsed.staleExpiresAt <= Date.now()) {
      return
    }

    runtimeCache.set(key, {
      ...parsed,
      value: normalizeJsonPayload(parsed.value),
      lastAccessedAt: Date.now(),
    })
    pruneRuntimeCacheIfNeeded()
  } catch {
    // Ignora entradas corrompidas no cache distribuido.
  }
}

function warmRuntimeCacheFromRedis(key: string) {
  if (redisWarmupsInFlight.has(key)) {
    return
  }

  redisWarmupsInFlight.add(key)
  void safeRedisOperation(async (redis) => {
    const serialized = await redis.get(getRedisKey(`runtime:${key}`))
    hydrateRuntimeCache(key, serialized)
  }).finally(() => {
    redisWarmupsInFlight.delete(key)
  })
}

function rememberRuntimeCacheKey(key: string) {
  void safeRedisOperation(async (redis) => {
    await redis.sadd(getRedisKey(CACHE_INDEX_KEY), key)
  })
}

function pruneRuntimeCacheIfNeeded() {
  if (runtimeCache.size <= CACHE_MAX_ENTRIES) {
    return
  }

  const entriesByAccess = [...runtimeCache.entries()].sort(
    (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
  )
  const removeCount = Math.max(runtimeCache.size - CACHE_MAX_ENTRIES, 1)

  for (const [key] of entriesByAccess.slice(0, removeCount)) {
    runtimeCache.delete(key)
  }
}

export function getRuntimeCache<T>(key: string) {
  const entry = runtimeCache.get(key)
  if (!entry) {
    warmRuntimeCacheFromRedis(key)
    return undefined
  }

  if (entry.expiresAt <= Date.now()) {
    if (entry.staleExpiresAt > Date.now()) {
      entry.lastAccessedAt = Date.now()
      warmRuntimeCacheFromRedis(key)
      return entry.value as T
    }

    runtimeCache.delete(key)
    warmRuntimeCacheFromRedis(key)
    return undefined
  }

  entry.lastAccessedAt = Date.now()
  return entry.value as T
}

export function setRuntimeCache<T>(key: string, value: T, ttlMs: number) {
  const now = Date.now()
  const normalizedValue = normalizeJsonPayload(value)
  runtimeCache.set(key, {
    version: CACHE_FORMAT_VERSION,
    value: normalizedValue,
    expiresAt: now + Math.max(ttlMs, 1),
    staleExpiresAt: now + Math.max(ttlMs, 1) + CACHE_STALE_GRACE_MS,
    lastAccessedAt: now,
  })
  pruneRuntimeCacheIfNeeded()

  rememberRuntimeCacheKey(key)
  void safeRedisOperation(async (redis) => {
    await redis.set(
      getRedisKey(`runtime:${key}`),
      serializeCacheValue(normalizedValue, ttlMs),
      'PX',
      Math.max(ttlMs + CACHE_STALE_GRACE_MS, 1)
    )
  })

  return normalizedValue
}

export function deleteRuntimeCache(key: string) {
  runtimeCache.delete(key)
  void safeRedisOperation(async (redis) => {
    await redis.del(getRedisKey(`runtime:${key}`))
    await redis.srem(getRedisKey(CACHE_INDEX_KEY), key)
  })
}

export function invalidateRuntimeCache(prefix?: string) {
  if (!prefix) {
    runtimeCache.clear()
    void safeRedisOperation(async (redis) => {
      const keys = await redis.smembers(getRedisKey(CACHE_INDEX_KEY))
      if (keys.length) {
        await redis.del(...keys.map((key) => getRedisKey(`runtime:${key}`)))
      }
      await redis.del(getRedisKey(CACHE_INDEX_KEY))
    })
    return
  }

  for (const key of runtimeCache.keys()) {
    if (key.startsWith(prefix)) {
      runtimeCache.delete(key)
    }
  }

  void safeRedisOperation(async (redis) => {
    const keys = await redis.smembers(getRedisKey(CACHE_INDEX_KEY))
    const matchingKeys = keys.filter((key) => key.startsWith(normalizePrefix(prefix)))
    if (matchingKeys.length) {
      await redis.del(...matchingKeys.map((key) => getRedisKey(`runtime:${key}`)))
      await redis.srem(getRedisKey(CACHE_INDEX_KEY), ...matchingKeys)
    }
  })
}
