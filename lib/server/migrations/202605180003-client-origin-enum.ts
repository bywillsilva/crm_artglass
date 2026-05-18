import { prisma } from '@/lib/db/prisma'

async function execute(sql: string) {
  await prisma.$executeRawUnsafe(sql)
}

export const migration202605180003 = {
  version: '202605180003',
  name: 'client-origin-enum-values',
  async run() {
    await execute(`
      ALTER TABLE clientes
      MODIFY COLUMN origem ENUM('site', 'indicacao', 'google', 'google_ads', 'facebook', 'instagram', 'prospeccao', 'telefone', 'outro') NULL DEFAULT NULL
    `)

    await execute(`
      UPDATE clientes
      SET origem = CASE
        WHEN LOWER(TRIM(origem)) IN ('google ads', 'google_ads', 'google') THEN 'google_ads'
        WHEN LOWER(TRIM(origem)) IN ('prospeccao', 'prospeccao ativa') THEN 'prospeccao'
        WHEN LOWER(TRIM(origem)) = 'indicacao' THEN 'indicacao'
        WHEN LOWER(TRIM(origem)) = 'outro' THEN 'outro'
        ELSE origem
      END
      WHERE origem IS NOT NULL
    `)
  },
}
