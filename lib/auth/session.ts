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

type AuthenticatedUserCacheEntry = {
  value: AuthenticatedServerUser | null
  cachedAt: number
}

const authenticatedUserCache = new Map<string, AuthenticatedUserCacheEntry>()

function getSecret() {
  return process.env.AUTH_SECRET || 'solarcrm-dev-secret'
}

function sign(value: string) {
  return createHmac('sha256', getSecret()).update(value).digest('hex')
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
    const [user] = await query<any[]>(
      `SELECT id, nome, email, avatar, role, ativo, module_permissions
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
