import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'

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
  rulePermissions?: unknown
}

const AUTH_USER_CACHE_MS = Math.max(Number(process.env.AUTH_USER_CACHE_MS || 5_000), 0)
const AUTH_USER_STALE_GRACE_MS = Math.max(
  Number(process.env.AUTH_USER_STALE_GRACE_MS || 30_000),
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
function getSecret() {
  return process.env.AUTH_SECRET || 'solarcrm-dev-secret'
}

function sign(value: string) {
  return createHmac('sha256', getSecret()).update(value).digest('hex')
}

export async function queryAuthenticatedUserById(userId: string) {
  const user = await prisma.usuarios.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      avatar: true,
      role: true,
      ativo: true,
      module_permissions: true,
      rule_permissions: true,
    },
  })

  return user ?? null
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
    const user = await queryAuthenticatedUserById(session.userId)

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
      modulePermissions: normalizeModulePermissions(user.module_permissions ?? null, user.role as RoleUsuario),
      rulePermissions: normalizeRulePermissions(user.rule_permissions ?? null, user.role as RoleUsuario),
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

    if (TRANSIENT_DB_ERROR_CODES.has(errorCode) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(errorCode)) {
      return {
        id: session.userId,
        nome: undefined,
        email: undefined,
        avatar: undefined,
        role: session.role,
        ativo: true,
        modulePermissions: null,
        rulePermissions: null,
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
