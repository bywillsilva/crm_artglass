import mysql from 'mysql2/promise'

const MYSQL_TIMEZONE = process.env.MYSQL_TIMEZONE || '-03:00'
const MYSQL_CONNECTION_LIMIT = Math.max(Number(process.env.MYSQL_CONNECTION_LIMIT || 12), 1)
const MYSQL_CONNECT_TIMEOUT = Math.max(Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 15000), 1000)
const MYSQL_ACQUIRE_RETRIES = Math.max(Number(process.env.MYSQL_ACQUIRE_RETRIES || 2), 0)
const MYSQL_ACQUIRE_RETRY_DELAY_MS = Math.max(
  Number(process.env.MYSQL_ACQUIRE_RETRY_DELAY_MS || 250),
  50
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

// Pool de conexoes para melhor performance
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
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
})

function isRetryableConnectionError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  return RETRYABLE_CONNECTION_CODES.has(code)
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

async function acquireConnection() {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MYSQL_ACQUIRE_RETRIES; attempt += 1) {
    let connection: PoolConnectionWithSessionFlag | null = null

    try {
      connection = (await pool.getConnection()) as PoolConnectionWithSessionFlag
      return await prepareConnection(connection)
    } catch (error) {
      releaseConnectionSafely(connection)
      lastError = error

      if (!isRetryableConnectionError(error) || attempt === MYSQL_ACQUIRE_RETRIES) {
        throw error
      }

      await wait(MYSQL_ACQUIRE_RETRY_DELAY_MS * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Nao foi possivel obter conexao com o banco')
}

export async function query<T>(sql: string, params?: any[]): Promise<T> {
  const connection = await acquireConnection()

  try {
    const [results] = await connection.execute(sql, params)
    return results as T
  } finally {
    releaseConnectionSafely(connection)
  }
}

export async function getConnection() {
  return acquireConnection()
}

export default pool
