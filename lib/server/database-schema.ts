import { query } from '@/lib/db/mysql'
import {
  ensureClientSchema,
  ensureCrmRuntimeSchema,
  ensureProposalKanbanOrderColumn,
  ensureProposalMaterialTagColumn,
  ensureProposalSequenceSchema,
  ensureProposalStatusSchema,
  ensureResponsibilityIntegrity,
  ensureTaskSchema,
  ensureUserManagementSchema,
} from '@/lib/server/proposal-workflow'
import { ensureRealtimeEventsSchema } from '@/lib/server/realtime-events'

const DATABASE_SCHEMA_CACHE_MS = 60 * 60 * 1000

let configuracoesSchemaCheckedAt = 0
let configuracoesSchemaPromise: Promise<void> | null = null
let supportTablesCheckedAt = 0
let supportTablesPromise: Promise<void> | null = null
let systemSchemaCheckedAt = 0
let systemSchemaPromise: Promise<void> | null = null

async function ensureConfiguracoesSchemaSafe() {
  const now = Date.now()
  if (now - configuracoesSchemaCheckedAt < DATABASE_SCHEMA_CACHE_MS) {
    return
  }

  if (configuracoesSchemaPromise) {
    await configuracoesSchemaPromise
    return
  }

  configuracoesSchemaPromise = (async () => {
    const columns = await query<any[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'configuracoes'`
    )

    const columnNames = new Set(columns.map((column) => String(column.COLUMN_NAME)))

    if (!columnNames.has('scope')) {
      await query(`ALTER TABLE configuracoes ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'global' AFTER chave`)
    }

    if (!columnNames.has('user_id')) {
      await query(`ALTER TABLE configuracoes ADD COLUMN user_id VARCHAR(36) NOT NULL DEFAULT '' AFTER scope`)
    }

    await query(`UPDATE configuracoes SET scope = 'global' WHERE scope IS NULL OR scope = ''`)
    await query(`UPDATE configuracoes SET user_id = '' WHERE user_id IS NULL`)

    const indexes = await query<any[]>('SHOW INDEX FROM configuracoes')
    const hasScopedUnique = indexes.some((index) => index.Key_name === 'unique_config_scope')
    const oldUniqueIndexes = indexes.filter(
      (index) => index.Non_unique === 0 && index.Key_name !== 'PRIMARY' && index.Key_name !== 'unique_config_scope'
    )

    for (const index of oldUniqueIndexes) {
      await query(`ALTER TABLE configuracoes DROP INDEX ${index.Key_name}`)
    }

    if (!hasScopedUnique) {
      await query(`ALTER TABLE configuracoes ADD UNIQUE KEY unique_config_scope (chave, scope, user_id)`)
    }

    configuracoesSchemaCheckedAt = Date.now()
  })()

  try {
    await configuracoesSchemaPromise
  } finally {
    configuracoesSchemaPromise = null
  }
}

async function ensureSupportTables() {
  const now = Date.now()
  if (now - supportTablesCheckedAt < DATABASE_SCHEMA_CACHE_MS) {
    return
  }

  if (supportTablesPromise) {
    await supportTablesPromise
    return
  }

  supportTablesPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id VARCHAR(36) PRIMARY KEY,
        usuario_id VARCHAR(36) NOT NULL,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id VARCHAR(36) PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS login_verification_tokens (
        id VARCHAR(36) PRIMARY KEY,
        usuario_id VARCHAR(36) NOT NULL,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        notification_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_notification (user_id, notification_id)
      )
    `)

    supportTablesCheckedAt = Date.now()
  })()

  try {
    await supportTablesPromise
  } finally {
    supportTablesPromise = null
  }
}

export async function ensureSystemDatabaseSchema() {
  const now = Date.now()
  if (now - systemSchemaCheckedAt < DATABASE_SCHEMA_CACHE_MS) {
    return
  }

  if (systemSchemaPromise) {
    await systemSchemaPromise
    return
  }

  systemSchemaPromise = (async () => {
    await ensureSupportTables()
    await ensureConfiguracoesSchemaSafe()
    await ensureUserManagementSchema()
    await ensureClientSchema()
    await ensureProposalSequenceSchema()
    await ensureProposalStatusSchema()
    await ensureProposalMaterialTagColumn()
    await ensureProposalKanbanOrderColumn()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()
    await ensureRealtimeEventsSchema()
    await ensureCrmRuntimeSchema()

    systemSchemaCheckedAt = Date.now()
  })()

  try {
    await systemSchemaPromise
  } finally {
    systemSchemaPromise = null
  }
}
