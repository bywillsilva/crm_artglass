import { prisma } from '@/lib/db/prisma'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

async function hasColumn(tableName: string, columnName: string) {
  const rows = await query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  )

  return rows.length > 0
}

async function ensureColumn(tableName: string, columnName: string, definitionSql: string) {
  if (!(await hasColumn(tableName, columnName))) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`)
  }
}

export const migration202605140001 = {
  version: '202605140001',
  name: 'client-address-fields',
  async run() {
    await ensureColumn('clientes', 'numero', 'numero VARCHAR(30) NULL AFTER endereco')
    await ensureColumn('clientes', 'bairro', 'bairro VARCHAR(120) NULL AFTER numero')
  },
}
