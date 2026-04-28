import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'

export const SESSION_COOKIE = 'solarcrm_session'

type SessionPayload = {
  userId: string
  role: string
  expiresAt: number
}

export type AuthenticatedServerUser = {
  id: string
  nome?: string
  email?: string
  avatar?: string
  role: string
  ativo: boolean
  modulePermissions?: unknown
}

const AUTH_USER_CACHE_MS = Math.max(Number(process.env.AUTH_USER_CACHE_MS || 30_000), 0)
const AUTH_USER_STALE_GRACE_MS = Math.max(
  Number(process.env.AUTH_USER_STALE_GRACE_MS || 120_000),
  AUTH_USER_CACHE_MS
)
const TRANSIENT_DB_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'DB_UNAVAILABLE',
])

type AuthenticatedUserCacheEntry = {
  value: AuthenticatedServerUser | null
  cachedAt: number
}

const authenticatedUserCache = new Map<string, AuthenticatedUserCacheEntry>()
const USER_OPTIONAL_COLUMNS_CACHE_MS = 60 * 60 * 1000

let userOptionalColumnsCheckedAt = 0
let userOptionalColumnsPromise: Promise<Set<string>> | null = null
let cachedUserOptionalColumns = new Set<string>()

function getSecret() {
  return process.env.AUTH_SECRET || 'solarcrm-dev-secret'
}

function sign(value: string) {
  return createHmac('sha256', getSecret()).update(value).digest('hex')
}

export async function getOptionalUserColumns() {
  const now = Date.now()
  if (now - userOptionalColumnsCheckedAt < USER_OPTIONAL_COLUMNS_CACHE_MS) {
    return cachedUserOptionalColumns
  }

  if (userOptionalColumnsPromise) {
    return userOptionalColumnsPromise
  }

  userOptionalColumnsPromise = (async () => {
    try {
      const columns = await query<any[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'usuarios'
           AND COLUMN_NAME IN ('module_permissions')`
      )

      cachedUserOptionalColumns = new Set(columns.map((column) => String(column.COLUMN_NAME)))
    } catch {
      cachedUserOptionalColumns = new Set<string>()
    }

    userOptionalColumnsCheckedAt = Date.now()
    return cachedUserOptionalColumns
  })()

  try {
    return await userOptionalColumnsPromise
  } finally {
    userOptionalColumnsPromise = null
  }
}

export function createSessionToken(userId: string, role: string, maxAgeSeconds = 60 * 60 * 12) {
  const payload: SessionPayload = {
    userId,
    role,
    expiresAt: Date.now() + maxAgeSeconds * 1000,
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) return null

  const expected = sign(encodedPayload)
  if (signature.length !== expected.length) {
    return null
  }

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as SessionPayload
    if (payload.expiresAt < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function getServerSession() {
  const cookieStore = await cookies()
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)
}

function readCachedAuthenticatedUser(userId: string, maxAgeMs: number) {
  if (maxAgeMs <= 0) {
    return undefined
  }

  const entry = authenticatedUserCache.get(userId)
  if (!entry) {
    return undefined
  }

  if (Date.now() - entry.cachedAt > maxAgeMs) {
    return undefined
  }

  return entry.value
}

function cacheAuthenticatedUser(userId: string, value: AuthenticatedServerUser | null) {
  authenticatedUserCache.set(userId, {
    value,
    cachedAt: Date.now(),
  })
}

export function clearAuthenticatedUserCache(userId?: string | null) {
  if (!userId) {
    authenticatedUserCache.clear()
    return
  }

  authenticatedUserCache.delete(userId)
}

export async function getAuthenticatedServerUser() {
  const session = await getServerSession()
  if (!session) {
    return null
  }

  const freshCachedUser = readCachedAuthenticatedUser(session.userId, AUTH_USER_CACHE_MS)
  if (freshCachedUser !== undefined) {
    return freshCachedUser
  }

  try {
    const optionalColumns = await getOptionalUserColumns()
    const modulePermissionsSelect = optionalColumns.has('module_permissions')
      ? ', module_permissions'
      : ''
    const [user] = await query<any[]>(
      `SELECT id, nome, email, avatar, role, ativo${modulePermissionsSelect}
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [session.userId]
    )

    if (!user || !user.ativo) {
      cacheAuthenticatedUser(session.userId, null)
      return null
    }

    const authenticatedUser = {
      id: user.id,
      nome: user.nome ?? undefined,
      email: user.email ?? undefined,
      avatar: user.avatar ?? undefined,
      role: user.role,
      ativo: Boolean(user.ativo),
      modulePermissions: user.module_permissions ?? null,
    } as AuthenticatedServerUser

    cacheAuthenticatedUser(session.userId, authenticatedUser)
    return authenticatedUser
  } catch (error) {
    const staleCachedUser = readCachedAuthenticatedUser(session.userId, AUTH_USER_STALE_GRACE_MS)
    if (staleCachedUser !== undefined) {
      return staleCachedUser
    }

    const errorCode =
      typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''

    if (TRANSIENT_DB_ERROR_CODES.has(errorCode)) {
      return {
        id: session.userId,
        nome: undefined,
        email: undefined,
        avatar: undefined,
        role: session.role,
        ativo: true,
        modulePermissions: null,
      } satisfies AuthenticatedServerUser
    }

    throw error
  }
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
