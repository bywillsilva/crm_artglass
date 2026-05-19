import { prisma } from '@/lib/db/prisma'

const FALLBACK_AVATAR_COLORS = [
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#14B8A6',
  '#F97316',
  '#64748B',
]

type Queryable = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>
}

function normalizeAvatarColor(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null
}

export function getStableAvatarColor(seed?: string | null) {
  const source = String(seed || 'usuario')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }
  return FALLBACK_AVATAR_COLORS[hash % FALLBACK_AVATAR_COLORS.length]
}

export function resolveAvatarColor(value: unknown, seed?: string | null) {
  return normalizeAvatarColor(value) || getStableAvatarColor(seed)
}

export async function getUserAvatarColor(userId?: string | null, client: Queryable = prisma) {
  if (!userId) return null

  const rows = await client.$queryRawUnsafe<Array<{ avatar_color: string | null }>>(
    'SELECT avatar_color FROM usuarios WHERE id = ? LIMIT 1',
    userId
  )

  return rows[0]?.avatar_color ?? null
}

export async function getUserAvatarColorMap(userIds: Array<string | null | undefined>, client: Queryable = prisma) {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map<string, string | null>()

  const placeholders = ids.map(() => '?').join(',')
  const rows = await client.$queryRawUnsafe<Array<{ id: string; avatar_color: string | null }>>(
    `SELECT id, avatar_color FROM usuarios WHERE id IN (${placeholders})`,
    ...ids
  )

  return new Map(rows.map((row) => [row.id, row.avatar_color]))
}

export async function setUserAvatarColor(userId: string, color: unknown, client: Queryable = prisma) {
  await client.$executeRawUnsafe(
    'UPDATE usuarios SET avatar_color = ? WHERE id = ?',
    resolveAvatarColor(color, userId),
    userId
  )
}

export async function attachAvatarColors<T extends { id: string; nome?: string | null }>(
  users: T[],
  client: Queryable = prisma
) {
  const colorMap = await getUserAvatarColorMap(users.map((user) => user.id), client)
  return users.map((user) => ({
    ...user,
    avatar_color: colorMap.get(user.id) ?? null,
    avatarColor: resolveAvatarColor(colorMap.get(user.id), user.nome),
  }))
}
