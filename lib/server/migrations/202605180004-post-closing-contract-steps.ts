import { prisma } from '@/lib/db/prisma'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

async function ensurePostClosingContractSteps() {
  const columns = await query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'propostas'`
  )
  const existing = new Set(columns.map((column) => column.COLUMN_NAME))

  if (!existing.has('pos_fechamento_aguardando_contrato_at')) {
    await query(`
      ALTER TABLE propostas
      ADD COLUMN pos_fechamento_aguardando_contrato_at DATETIME NULL
      AFTER kanban_order
    `)
  }

  if (!existing.has('pos_fechamento_contrato_assinado_at')) {
    await query(`
      ALTER TABLE propostas
      ADD COLUMN pos_fechamento_contrato_assinado_at DATETIME NULL
      AFTER pos_fechamento_contrato_enviado_at
    `)
  }
}

export const migration202605180004 = {
  version: '202605180004',
  name: 'post-closing-contract-steps',
  async run() {
    await ensurePostClosingContractSteps()
  },
}
