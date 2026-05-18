import { prisma } from '@/lib/db/prisma'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

async function ensurePostClosingNewSteps() {
  const columns = await query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'propostas'`
  )
  const existing = new Set(columns.map((column) => column.COLUMN_NAME))
  const hasLegacyCreatedOsColumn = existing.has('pos_fechamento_ordem_servico_criada_at')

  if (!existing.has('pos_fechamento_aguardando_pagamento_at')) {
    await query(`
      ALTER TABLE propostas
      ADD COLUMN pos_fechamento_aguardando_pagamento_at DATETIME NULL
      AFTER pos_fechamento_contrato_enviado_at
    `)
  }

  if (!existing.has('pos_fechamento_aguardando_os_at')) {
    await query(`
      ALTER TABLE propostas
      ADD COLUMN pos_fechamento_aguardando_os_at DATETIME NULL
      AFTER pos_fechamento_pagamento_confirmado_at
    `)
  }

  await query(`
    UPDATE propostas
    SET pos_fechamento_aguardando_pagamento_at = COALESCE(
      pos_fechamento_contrato_enviado_at,
      pos_fechamento_pagamento_confirmado_at
    )
    WHERE pos_fechamento_aguardando_pagamento_at IS NULL
      AND pos_fechamento_pagamento_confirmado_at IS NOT NULL
  `)

  if (hasLegacyCreatedOsColumn) {
    await query(`
      UPDATE propostas
      SET pos_fechamento_aguardando_os_at = COALESCE(
        pos_fechamento_ordem_servico_criada_at,
        pos_fechamento_ordem_servico_liberada_at
      )
      WHERE pos_fechamento_aguardando_os_at IS NULL
        AND (
          pos_fechamento_ordem_servico_criada_at IS NOT NULL
          OR pos_fechamento_ordem_servico_liberada_at IS NOT NULL
        )
    `)

    await query(`ALTER TABLE propostas DROP COLUMN pos_fechamento_ordem_servico_criada_at`)
  } else {
    await query(`
      UPDATE propostas
      SET pos_fechamento_aguardando_os_at = pos_fechamento_ordem_servico_liberada_at
      WHERE pos_fechamento_aguardando_os_at IS NULL
        AND pos_fechamento_ordem_servico_liberada_at IS NOT NULL
    `)
  }
}

export const migration202605180002 = {
  version: '202605180002',
  name: 'post-closing-new-steps',
  async run() {
    await ensurePostClosingNewSteps()
  },
}
