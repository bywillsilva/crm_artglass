import { prisma } from '@/lib/db/prisma'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'
import { syncProposalServices } from '@/lib/server/proposal-services'
import { syncNormalizedUserPermissions } from '@/lib/server/user-permissions-store'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

function parseJsonRecord(value: unknown) {
  if (!value) return null

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readTextValue(record: Record<string, unknown> | null, key: string) {
  if (!record) return null
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readBooleanValue(record: Record<string, unknown> | null, key: string) {
  if (!record) return null
  const value = record[key]

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }

  return null
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

async function hasIndex(tableName: string, indexName: string) {
  const rows = await query<Array<{ INDEX_NAME: string }>>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  )

  return rows.length > 0
}

async function ensureIndex(tableName: string, indexName: string, columnsSql: string) {
  if (!(await hasIndex(tableName, indexName))) {
    await query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columnsSql})`)
  }
}

async function hasForeignKey(tableName: string, constraintName: string) {
  const rows = await query<Array<{ CONSTRAINT_NAME: string }>>(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  )

  return rows.length > 0
}

async function ensureForeignKey(tableName: string, constraintName: string, ddl: string) {
  if (!(await hasForeignKey(tableName, constraintName))) {
    await query(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${ddl}`)
  }
}

async function hasTrigger(triggerName: string) {
  const rows = await query<Array<{ TRIGGER_NAME: string }>>(
    `SELECT TRIGGER_NAME
     FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME = ?
     LIMIT 1`,
    [triggerName]
  )

  return rows.length > 0
}

async function backfillInteractionColumns() {
  const interactions = await query<
    Array<{
      id: string
      dados: unknown
      proposta_id?: string | null
      novo_status?: string | null
      notification_kind?: string | null
      origem?: string | null
      silent_notification?: number | boolean | null
    }>
  >(
    `SELECT id, dados, proposta_id, novo_status, notification_kind, origem, silent_notification
     FROM interacoes`
  )

  for (const interaction of interactions) {
    const payload = parseJsonRecord(interaction.dados)
    if (!payload) {
      continue
    }

    const propostaId = interaction.proposta_id || readTextValue(payload, 'proposta_id')
    const novoStatus =
      interaction.novo_status ||
      readTextValue(payload, 'novo_status') ||
      readTextValue(payload, 'status')
    const notificationKind =
      interaction.notification_kind || readTextValue(payload, 'notification_kind')
    const origem =
      interaction.origem || readTextValue(payload, 'origem') || readTextValue(payload, 'origin')
    const silentNotification =
      readBooleanValue(payload, 'silent_notification') ??
      Boolean(interaction.silent_notification)

    await query(
      `UPDATE interacoes
       SET proposta_id = ?, novo_status = ?, notification_kind = ?, origem = ?, silent_notification = ?
       WHERE id = ?`,
      [propostaId, novoStatus, notificationKind, origem, silentNotification, interaction.id]
    )
  }
}

async function backfillProposalServices() {
  await query('DELETE FROM proposta_servicos')

  const proposals = await query<Array<{ id: string; servicos: unknown }>>(
    'SELECT id, servicos FROM propostas'
  )

  for (const proposal of proposals) {
    let rawServices: unknown = proposal.servicos

    if (typeof proposal.servicos === 'string') {
      try {
        rawServices = JSON.parse(proposal.servicos)
      } catch {
        rawServices = []
      }
    }

    await syncProposalServices(proposal.id, rawServices)
  }
}

async function backfillNormalizedUserPermissions() {
  const users = await query<
    Array<{
      id: string
      role: string | null
      module_permissions: unknown
      rule_permissions: unknown
    }>
  >(
    `SELECT id, role, module_permissions, rule_permissions
     FROM usuarios`
  )

  for (const user of users) {
    const role = ((user.role || 'vendedor') as RoleUsuario)
    await syncNormalizedUserPermissions({
      userId: user.id,
      role,
      modulePermissions: parseJsonRecord(user.module_permissions) ?? normalizeModulePermissions(null, role),
      rulePermissions: parseJsonRecord(user.rule_permissions) ?? normalizeRulePermissions(null, role),
    })
  }
}

async function cleanupIntegrityViolations() {
  await query(`
    UPDATE propostas p
    LEFT JOIN usuarios u ON u.id = p.orcamentista_id
    SET p.orcamentista_id = NULL
    WHERE p.orcamentista_id IS NOT NULL
      AND u.id IS NULL
  `)

  await query(`
    UPDATE tarefas t
    LEFT JOIN propostas p ON p.id = t.proposta_id
    SET t.proposta_id = NULL
    WHERE t.proposta_id IS NOT NULL
      AND p.id IS NULL
  `)

  await query(`
    DELETE pa
    FROM proposta_anexos pa
    LEFT JOIN propostas p ON p.id = pa.proposta_id
    WHERE p.id IS NULL
  `)

  await query(`
    UPDATE proposta_anexos pa
    LEFT JOIN usuarios u ON u.id = pa.usuario_id
    SET pa.usuario_id = NULL
    WHERE pa.usuario_id IS NOT NULL
      AND u.id IS NULL
  `)

  await query(`
    DELETE pc
    FROM proposta_comentarios pc
    LEFT JOIN propostas p ON p.id = pc.proposta_id
    WHERE p.id IS NULL
  `)

  await query(`
    UPDATE proposta_comentarios pc
    LEFT JOIN usuarios u ON u.id = pc.usuario_id
    SET pc.usuario_id = NULL
    WHERE pc.usuario_id IS NOT NULL
      AND u.id IS NULL
  `)

  await query(`
    UPDATE interacoes i
    LEFT JOIN propostas p ON p.id = i.proposta_id
    SET i.proposta_id = NULL
    WHERE i.proposta_id IS NOT NULL
      AND p.id IS NULL
  `)
}

async function ensureInteractionNormalizationTrigger() {
  if (await hasTrigger('interacoes_before_insert_normalize')) {
    await query('DROP TRIGGER interacoes_before_insert_normalize')
  }

  await query(`
    CREATE TRIGGER interacoes_before_insert_normalize
    BEFORE INSERT ON interacoes
    FOR EACH ROW
    SET
      NEW.proposta_id = COALESCE(
        NULLIF(NEW.proposta_id, ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.proposta_id')), '')
      ),
      NEW.novo_status = COALESCE(
        NULLIF(NEW.novo_status, ''),
        NULLIF(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.novo_status')),
            JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.status'))
          ),
          ''
        )
      ),
      NEW.notification_kind = COALESCE(
        NULLIF(NEW.notification_kind, ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.notification_kind')), '')
      ),
      NEW.origem = COALESCE(
        NULLIF(NEW.origem, ''),
        NULLIF(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.origem')),
            JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.origin'))
          ),
          ''
        )
      ),
      NEW.silent_notification = CASE
        WHEN JSON_EXTRACT(NEW.dados, '$.silent_notification') IS NULL THEN NEW.silent_notification
        WHEN LOWER(JSON_UNQUOTE(JSON_EXTRACT(NEW.dados, '$.silent_notification'))) IN ('1', 'true') THEN 1
        ELSE 0
      END
  `)
}

export const migration202605130004 = {
  version: '202605130004',
  name: 'crm-integrity-normalization',
  async run() {
    await query(`
      CREATE TABLE IF NOT EXISTS proposta_servicos (
        id VARCHAR(36) PRIMARY KEY,
        proposta_id VARCHAR(36) NOT NULL,
        nome VARCHAR(255) NOT NULL,
        ordem INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS usuario_modulo_permissoes (
        user_id VARCHAR(36) NOT NULL,
        module_key VARCHAR(50) NOT NULL,
        allowed TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, module_key)
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS usuario_regra_permissoes (
        user_id VARCHAR(36) NOT NULL,
        rule_key VARCHAR(80) NOT NULL,
        allowed TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, rule_key)
      )
    `)

    await ensureColumn('interacoes', 'proposta_id', 'proposta_id VARCHAR(36) NULL AFTER cliente_id')
    await ensureColumn('interacoes', 'novo_status', 'novo_status VARCHAR(60) NULL AFTER dados')
    await ensureColumn(
      'interacoes',
      'notification_kind',
      'notification_kind VARCHAR(60) NULL AFTER novo_status'
    )
    await ensureColumn('interacoes', 'origem', 'origem VARCHAR(80) NULL AFTER notification_kind')
    await ensureColumn(
      'interacoes',
      'silent_notification',
      'silent_notification TINYINT(1) NOT NULL DEFAULT 0 AFTER origem'
    )

    await query('ALTER TABLE proposta_anexos MODIFY COLUMN usuario_id VARCHAR(36) NULL')
    await query('ALTER TABLE proposta_comentarios MODIFY COLUMN usuario_id VARCHAR(36) NULL')

    await backfillInteractionColumns()
    await backfillProposalServices()
    await backfillNormalizedUserPermissions()
    await cleanupIntegrityViolations()

    if (await hasIndex('usuarios', 'idx_usuarios_email')) {
      await query('ALTER TABLE usuarios DROP INDEX idx_usuarios_email')
    }

    await ensureIndex('interacoes', 'idx_interacoes_proposta_created', 'proposta_id, created_at')
    await ensureIndex(
      'interacoes',
      'idx_interacoes_tipo_notification_created',
      'tipo, notification_kind, created_at'
    )
    await ensureIndex('proposta_servicos', 'idx_proposta_servicos_proposta_ordem', 'proposta_id, ordem')
    await ensureIndex(
      'usuario_modulo_permissoes',
      'idx_usuario_modulo_permissoes_module',
      'module_key'
    )
    await ensureIndex(
      'usuario_regra_permissoes',
      'idx_usuario_regra_permissoes_rule',
      'rule_key'
    )

    await ensureForeignKey(
      'propostas',
      'fk_propostas_orcamentista',
      'FOREIGN KEY (orcamentista_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'tarefas',
      'fk_tarefas_proposta',
      'FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE SET NULL ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'interacoes',
      'fk_interacoes_proposta',
      'FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE SET NULL ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'proposta_servicos',
      'fk_proposta_servicos_proposta',
      'FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'proposta_anexos',
      'fk_proposta_anexos_proposta',
      'FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'proposta_anexos',
      'fk_proposta_anexos_usuario',
      'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'proposta_comentarios',
      'fk_proposta_comentarios_proposta',
      'FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'proposta_comentarios',
      'fk_proposta_comentarios_usuario',
      'FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'usuario_modulo_permissoes',
      'fk_usuario_modulo_permissoes_usuario',
      'FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE'
    )
    await ensureForeignKey(
      'usuario_regra_permissoes',
      'fk_usuario_regra_permissoes_usuario',
      'FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE'
    )

    await ensureInteractionNormalizationTrigger()
  },
}
