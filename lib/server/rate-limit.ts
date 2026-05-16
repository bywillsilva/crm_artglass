import { getRedisKey, safeRedisOperation } from '@/lib/server/redis'

type LocalRateLimitEntry = {
  count: number
  resetAt: number
}

const localRateLimits = new Map<string, LocalRateLimitEntry>()

export type RateLimitResult = {
  allowed: boolean
  count: number
  limit: number
  resetAt: number
}

function getLocalRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const current = localRateLimits.get(key)
  const entry =
    current && current.resetAt > now
      ? current
      : {
          count: 0,
          resetAt: now + windowMs,
        }

  entry.count += 1
  localRateLimits.set(key, entry)

  return {
    allowed: entry.count <= limit,
    count: entry.count,
    limit,
    resetAt: entry.resetAt,
  }
}

export async function checkRateLimit(params: {
  key: string
  limit: number
  windowMs: number
}) {
  const redisResult = await safeRedisOperation(async (redis) => {
    const redisKey = getRedisKey(`rate-limit:${params.key}`)
    const count = await redis.incr(redisKey)

    if (count === 1) {
      await redis.pexpire(redisKey, params.windowMs)
    }

    const ttl = await redis.pttl(redisKey)
    const resetAt = Date.now() + Math.max(ttl, 0)

    return {
      allowed: count <= params.limit,
      count,
      limit: params.limit,
      resetAt,
    } satisfies RateLimitResult
  })

  return redisResult ?? getLocalRateLimit(params.key, params.limit, params.windowMs)
}
