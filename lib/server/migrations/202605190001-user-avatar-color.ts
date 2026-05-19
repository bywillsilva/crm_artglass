import { prisma } from '@/lib/db/prisma'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

async function ensureUserAvatarColor() {
  const columns = await query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'usuarios'`
  )
  const existing = new Set(columns.map((column) => column.COLUMN_NAME))

  if (!existing.has('avatar_color')) {
    await query(`
      ALTER TABLE usuarios
      ADD COLUMN avatar_color VARCHAR(20) NULL
      AFTER avatar
    `)
  }

  await query(`
    UPDATE usuarios
    SET avatar_color = CASE MOD(CRC32(id), 8)
      WHEN 0 THEN '#0EA5E9'
      WHEN 1 THEN '#10B981'
      WHEN 2 THEN '#F59E0B'
      WHEN 3 THEN '#EF4444'
      WHEN 4 THEN '#8B5CF6'
      WHEN 5 THEN '#14B8A6'
      WHEN 6 THEN '#F97316'
      ELSE '#64748B'
    END
    WHERE avatar_color IS NULL OR avatar_color = ''
  `)
}

export const migration202605190001 = {
  version: '202605190001',
  name: 'user-avatar-color',
  async run() {
    await ensureUserAvatarColor()
  },
}
