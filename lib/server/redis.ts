import Redis from 'ioredis'

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: Redis | null
  redisUnavailableUntil?: number
}

const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || ''
const REDIS_ENABLED = /^(1|true|yes)$/i.test(process.env.REDIS_ENABLED || '') || Boolean(REDIS_URL)
const REDIS_KEY_PREFIX = (process.env.REDIS_KEY_PREFIX || 'crm').replace(/:+$/g, '')
const REDIS_CONNECT_TIMEOUT_MS = Math.max(Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 2000), 500)
const REDIS_COMMAND_TIMEOUT_MS = Math.max(Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 1500), 300)
const REDIS_RETRY_COOLDOWN_MS = Math.max(Number(process.env.REDIS_RETRY_COOLDOWN_MS || 30000), 5000)

function markRedisUnavailable(error?: unknown) {
  globalForRedis.redisUnavailableUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Redis indisponivel; usando cache local temporariamente.', error)
  }
}

export function isRedisEnabled() {
  return REDIS_ENABLED && Boolean(REDIS_URL)
}

export function getRedisKey(key: string) {
  return `${REDIS_KEY_PREFIX}:${key}`
}

export function getRedisClient() {
  if (!isRedisEnabled()) {
    return null
  }

  if (Date.now() < (globalForRedis.redisUnavailableUntil || 0)) {
    return null
  }

  if (globalForRedis.redisClient) {
    return globalForRedis.redisClient
  }

  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    retryStrategy(times) {
      return times > 1 ? null : 250
    },
  })

  client.on('error', (error) => {
    markRedisUnavailable(error)
  })

  globalForRedis.redisClient = client
  return client
}

export async function safeRedisOperation<T>(operation: (client: Redis) => Promise<T>) {
  const client = getRedisClient()
  if (!client) {
    return null
  }

  try {
    if (client.status === 'wait') {
      await client.connect()
    }

    return await operation(client)
  } catch (error) {
    markRedisUnavailable(error)
    return null
  }
}
