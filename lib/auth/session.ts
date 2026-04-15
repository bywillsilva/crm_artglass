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

export async function getAuthenticatedServerUser() {
  const session = await getServerSession()
  if (!session) {
    return null
  }

  const [user] = await query<any[]>(
    `SELECT id, nome, email, avatar, role, ativo, module_permissions
     FROM usuarios
     WHERE id = ?
     LIMIT 1`,
    [session.userId]
  )

  if (!user || !user.ativo) {
    return null
  }

  return {
    id: user.id,
    nome: user.nome ?? undefined,
    email: user.email ?? undefined,
    avatar: user.avatar ?? undefined,
    role: user.role,
    ativo: Boolean(user.ativo),
    modulePermissions: user.module_permissions ?? null,
  } as AuthenticatedServerUser
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
