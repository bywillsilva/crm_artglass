type RuntimeCacheEntry<T> = {
  value: T
  expiresAt: number
}

const runtimeCache = new Map<string, RuntimeCacheEntry<unknown>>()

export function getRuntimeCache<T>(key: string) {
  const entry = runtimeCache.get(key)
  if (!entry) {
    return undefined
  }

  if (entry.expiresAt <= Date.now()) {
    runtimeCache.delete(key)
    return undefined
  }

  return entry.value as T
}

export function setRuntimeCache<T>(key: string, value: T, ttlMs: number) {
  runtimeCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(ttlMs, 1),
  })

  return value
}

export function deleteRuntimeCache(key: string) {
  runtimeCache.delete(key)
}

export function invalidateRuntimeCache(prefix?: string) {
  if (!prefix) {
    runtimeCache.clear()
    return
  }

  for (const key of runtimeCache.keys()) {
    if (key.startsWith(prefix)) {
      runtimeCache.delete(key)
    }
  }
}
