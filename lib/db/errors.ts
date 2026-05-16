const RETRYABLE_CONNECTION_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ER_USER_LIMIT_REACHED',
  'ER_CON_COUNT_ERROR',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
])

const RETRYABLE_CONNECTION_MESSAGE_PATTERNS = [
  /connection is in closed state/i,
  /closed state/i,
  /pool timeout/i,
  /failed to retrieve a connection from pool/i,
  /max_connections_per_hour/i,
  /too many connections/i,
  /read ECONNRESET/i,
  /socket hang up/i,
]

function getDatabaseErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
}

function getDatabaseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'object' && error && 'message' in error
    ? String((error as any).message || '')
    : ''
}

function isRetryableConnectionError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  if (RETRYABLE_CONNECTION_CODES.has(code)) {
    return true
  }

  const message = getDatabaseErrorMessage(error)
  return RETRYABLE_CONNECTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
}

export function isTransientDatabaseError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  return code === 'DB_UNAVAILABLE' || isRetryableConnectionError(error)
}

export function logDatabaseError(context: string, error: unknown) {
  if (isTransientDatabaseError(error)) {
    const code = getDatabaseErrorCode(error) || 'DB_UNAVAILABLE'
    console.warn(`${context}: falha transitoria de banco (${code})`)
    return
  }

  console.error(context, error)
}
