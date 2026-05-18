import { prisma } from '@/lib/db/prisma'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'
import { syncNormalizedUserPermissions } from '@/lib/server/user-permissions-store'
import { clearAuthenticatedUserCache } from '@/lib/auth/session'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

function normalizeRole(value: unknown): RoleUsuario {
  if (value === 'admin' || value === 'gerente' || value === 'orcamentista' || value === 'vendedor') {
    return value
  }

  return 'vendedor'
}

function parseJsonRecord(value: unknown) {
  if (!value || typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const PROPOSAL_STATUSES = [
  'novo_cliente',
  'em_orcamento',
  'aguardando_aprovacao',
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'aguardando_follow_up_3_dias',
  'follow_up_3_dias',
  'aguardando_follow_up_7_dias',
  'follow_up_7_dias',
  'stand_by',
  'em_retificacao',
  'fechado',
  'pos_fechamento',
  'perdido',
]

function enumValues(values: readonly string[]) {
  return values.map((value) => `'${value}'`).join(', ')
}

async function ensureProposalPostClosingFields() {
  await query(`
    ALTER TABLE propostas
    MODIFY COLUMN status ENUM(${enumValues(PROPOSAL_STATUSES)}) DEFAULT 'novo_cliente'
  `)

  const columns = await query<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'propostas'`
  )
  const existing = new Set(columns.map((column) => column.COLUMN_NAME))

  const definitions = [
    {
      name: 'pos_fechamento_contrato_feito_at',
      sql: 'ALTER TABLE propostas ADD COLUMN pos_fechamento_contrato_feito_at DATETIME NULL AFTER kanban_order',
    },
    {
      name: 'pos_fechamento_contrato_enviado_at',
      sql: 'ALTER TABLE propostas ADD COLUMN pos_fechamento_contrato_enviado_at DATETIME NULL AFTER pos_fechamento_contrato_feito_at',
    },
    {
      name: 'pos_fechamento_pagamento_confirmado_at',
      sql: 'ALTER TABLE propostas ADD COLUMN pos_fechamento_pagamento_confirmado_at DATETIME NULL AFTER pos_fechamento_contrato_enviado_at',
    },
    {
      name: 'pos_fechamento_ordem_servico_liberada_at',
      sql: 'ALTER TABLE propostas ADD COLUMN pos_fechamento_ordem_servico_liberada_at DATETIME NULL AFTER pos_fechamento_pagamento_confirmado_at',
    },
  ]

  for (const definition of definitions) {
    if (!existing.has(definition.name)) {
      await query(definition.sql)
    }
  }
}

async function backfillUserRules() {
  const users = await query<Array<{ id: string; role: string | null; module_permissions: string | null; rule_permissions: string | null }>>(
    `SELECT id, role, module_permissions, rule_permissions
     FROM usuarios`
  )

  for (const user of users) {
    const role = normalizeRole(user.role)
    const rulePermissions = normalizeRulePermissions(parseJsonRecord(user.rule_permissions), role)

    await query(
      `UPDATE usuarios
       SET rule_permissions = ?
       WHERE id = ?`,
      [JSON.stringify(rulePermissions), user.id]
    )

    await syncNormalizedUserPermissions({
      userId: user.id,
      role,
      modulePermissions: parseJsonRecord(user.module_permissions),
      rulePermissions,
    })
  }

  clearAuthenticatedUserCache()
}

export const migration202605180001 = {
  version: '202605180001',
  name: 'post-closing-workflow',
  async run() {
    await ensureProposalPostClosingFields()
    await backfillUserRules()
  },
}
