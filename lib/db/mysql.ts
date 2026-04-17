import mysql from 'mysql2/promise'

const MYSQL_TIMEZONE = process.env.MYSQL_TIMEZONE || '-03:00'
const MYSQL_PORT = Math.max(Number(process.env.MYSQL_PORT || 3306), 1)
const MYSQL_SSL_ENABLED = /^(1|true|required)$/i.test(process.env.MYSQL_SSL || '')
const MYSQL_CONNECTION_LIMIT = Math.max(Number(process.env.MYSQL_CONNECTION_LIMIT || 12), 1)
const MYSQL_CONNECT_TIMEOUT = Math.max(Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 3000), 1000)
const MYSQL_ACQUIRE_RETRIES = Math.max(Number(process.env.MYSQL_ACQUIRE_RETRIES || 0), 0)
const MYSQL_ACQUIRE_RETRY_DELAY_MS = Math.max(
  Number(process.env.MYSQL_ACQUIRE_RETRY_DELAY_MS || 250),
  50
)
const MYSQL_FAILURE_COOLDOWN_MS = Math.max(
  Number(process.env.MYSQL_FAILURE_COOLDOWN_MS || 15000),
  1000
)
const RETRYABLE_CONNECTION_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
])

type PoolConnectionWithSessionFlag = mysql.PoolConnection & {
  __crmTimeZoneReady?: boolean
}

let unavailableUntil = 0
let lastConnectionError: unknown = null

// Pool de conexoes para melhor performance
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: MYSQL_PORT,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  timezone: MYSQL_TIMEZONE,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: MYSQL_CONNECTION_LIMIT,
  maxIdle: MYSQL_CONNECTION_LIMIT,
  idleTimeout: 60_000,
  queueLimit: 0,
  connectTimeout: MYSQL_CONNECT_TIMEOUT,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ...(MYSQL_SSL_ENABLED ? { ssl: { rejectUnauthorized: false } } : {}),
})

function isRetryableConnectionError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  return RETRYABLE_CONNECTION_CODES.has(code)
}

export function isTransientDatabaseError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  return code === 'DB_UNAVAILABLE' || RETRYABLE_CONNECTION_CODES.has(code)
}

export function logDatabaseError(context: string, error: unknown) {
  if (isTransientDatabaseError(error)) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : 'DB_UNAVAILABLE'
    console.warn(`${context}: falha transitória de banco (${code})`)
    return
  }

  console.error(context, error)
}

function createDatabaseUnavailableError(error?: unknown) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Banco temporariamente indisponivel'

  const wrapped = new Error(message)
  ;(wrapped as Error & { code?: string }).code =
    (typeof error === 'object' && error && 'code' in error ? String((error as any).code) : '') ||
    'DB_UNAVAILABLE'
  return wrapped
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function prepareConnection(connection: PoolConnectionWithSessionFlag) {
  if (!connection.__crmTimeZoneReady) {
    await connection.query('SET time_zone = ?', [MYSQL_TIMEZONE])
    connection.__crmTimeZoneReady = true
  }

  return connection
}

function releaseConnectionSafely(connection?: PoolConnectionWithSessionFlag | null) {
  if (!connection) return

  try {
    connection.release()
  } catch {
    // Ignora falhas ao devolver conexoes ja encerradas.
  }
}

function destroyConnectionSafely(connection?: PoolConnectionWithSessionFlag | null) {
  if (!connection) return

  try {
    connection.destroy()
  } catch {
    // Ignora falhas ao destruir conexoes ja encerradas.
  }
}

async function acquireConnection() {
  if (Date.now() < unavailableUntil) {
    throw createDatabaseUnavailableError(lastConnectionError)
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt <= MYSQL_ACQUIRE_RETRIES; attempt += 1) {
    let connection: PoolConnectionWithSessionFlag | null = null

    try {
      connection = (await pool.getConnection()) as PoolConnectionWithSessionFlag
      const preparedConnection = await prepareConnection(connection)
      unavailableUntil = 0
      lastConnectionError = null
      return preparedConnection
    } catch (error) {
      releaseConnectionSafely(connection)
      lastError = error

      if (isRetryableConnectionError(error)) {
        unavailableUntil = Date.now() + MYSQL_FAILURE_COOLDOWN_MS
        lastConnectionError = error
      }

      if (!isRetryableConnectionError(error) || attempt === MYSQL_ACQUIRE_RETRIES) {
        throw createDatabaseUnavailableError(error)
      }

      await wait(MYSQL_ACQUIRE_RETRY_DELAY_MS * (attempt + 1))
    }
  }

  throw createDatabaseUnavailableError(lastError)
}

export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const connection = await acquireConnection()

  try {
    const [results] = await connection.execute(sql, params)
    return results as T
  } catch (error) {
    if (isRetryableConnectionError(error)) {
      unavailableUntil = Date.now() + MYSQL_FAILURE_COOLDOWN_MS
      lastConnectionError = error
      destroyConnectionSafely(connection)
    }

    throw createDatabaseUnavailableError(error)
  } finally {
    releaseConnectionSafely(connection)
  }
}

export async function getConnection() {
  return acquireConnection()
}

export default pool
