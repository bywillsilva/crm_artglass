import { query } from '@/lib/db/mysql'
import { migration202605130001 } from '@/lib/server/migrations/202605130001-baseline-crm-schema'
import { migration202605130002 } from '@/lib/server/migrations/202605130002-follow-up-stage-offsets'
import { migration202605130003 } from '@/lib/server/migrations/202605130003-user-rule-permissions'
import { migration202605130004 } from '@/lib/server/migrations/202605130004-crm-integrity-normalization'
import { migration202605140001 } from '@/lib/server/migrations/202605140001-client-address-fields'
import { migration202605140002 } from '@/lib/server/migrations/202605140002-normalize-existing-user-permissions'

const MIGRATION_TABLE_NAME = 'schema_migrations'

export type SchemaMigration = {
  version: string
  name: string
  run: () => Promise<void>
}

type AppliedSchemaMigrationRow = {
  version: string
  name: string
  applied_at: string
  execution_ms: number | null
}

const SYSTEM_SCHEMA_MIGRATIONS: SchemaMigration[] = [
  migration202605130001,
  migration202605130002,
  migration202605130003,
  migration202605130004,
  migration202605140001,
  migration202605140002,
]

async function ensureSchemaMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
      version VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT UNSIGNED NULL
    )
  `)
}

export function listKnownSchemaMigrations() {
  return SYSTEM_SCHEMA_MIGRATIONS.map((migration) => ({
    version: migration.version,
    name: migration.name,
  }))
}

export async function listAppliedSchemaMigrations() {
  await ensureSchemaMigrationsTable()

  return query<AppliedSchemaMigrationRow[]>(
    `SELECT version, name, applied_at, execution_ms
     FROM ${MIGRATION_TABLE_NAME}
     ORDER BY version ASC`
  )
}

export async function getSchemaMigrationStatus() {
  const applied = await listAppliedSchemaMigrations()
  const appliedVersions = new Set(applied.map((item) => item.version))
  const known = listKnownSchemaMigrations()
  const pending = known.filter((migration) => !appliedVersions.has(migration.version))

  return {
    totalKnown: known.length,
    appliedCount: applied.length,
    pendingCount: pending.length,
    applied,
    pending,
  }
}

export async function runPendingSchemaMigrations() {
  await ensureSchemaMigrationsTable()

  const appliedRows = await query<Array<{ version: string }>>(
    `SELECT version FROM ${MIGRATION_TABLE_NAME}`
  )
  const appliedVersions = new Set(appliedRows.map((row) => String(row.version)))
  const appliedThisRun: string[] = []

  for (const migration of SYSTEM_SCHEMA_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue
    }

    const startedAt = Date.now()
    await migration.run()
    const executionMs = Math.max(Date.now() - startedAt, 0)

    await query(
      `INSERT INTO ${MIGRATION_TABLE_NAME} (version, name, execution_ms)
       VALUES (?, ?, ?)`,
      [migration.version, migration.name, executionMs]
    )

    appliedVersions.add(migration.version)
    appliedThisRun.push(migration.version)
  }

  const pendingCount = SYSTEM_SCHEMA_MIGRATIONS.length - appliedVersions.size

  return {
    totalKnown: SYSTEM_SCHEMA_MIGRATIONS.length,
    appliedThisRun,
    appliedCount: appliedVersions.size,
    pendingCount,
  }
}
