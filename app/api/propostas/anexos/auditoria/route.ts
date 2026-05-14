import { promises as fs } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import {
  ensureProposalMaterialTagColumn,
  ensureProposalStatusSchema,
} from '@/lib/server/proposal-workflow'
import {
  resolveStoredProposalFilePath,
  toStoredRelativeProposalPath,
} from '@/lib/server/proposal-files'

type AttachmentAuditRow = {
  id: string
  proposta_id: string
  nome_arquivo: string | null
  nome_original: string | null
  caminho: string | null
  conteudo: Buffer | null
  created_at: string | null
}

type AttachmentAuditItem = {
  id: string
  propostaId: string
  nomeArquivo: string | null
  nomeOriginal: string | null
  caminho: string | null
  storageMode: 'embedded' | 'relative' | 'absolute_legacy' | 'missing_path'
  fileExistsOnDisk: boolean
  recoverable: boolean
  risky: boolean
  createdAt: string | null
}

async function ensureBaseSchema() {
  await ensureProposalStatusSchema()
  await ensureProposalMaterialTagColumn()
}

async function getAdminUser() {
  const user = await getAuthenticatedServerUser()
  if (!user) return null
  if (!hasRuleAccess(user, 'canAuditProposalAttachments')) return null
  return user
}

function inferStorageMode(row: AttachmentAuditRow): AttachmentAuditItem['storageMode'] {
  const rawPath = String(row.caminho || '').trim()
  if (!rawPath) {
    return 'missing_path'
  }

  if (path.isAbsolute(rawPath)) {
    return 'absolute_legacy'
  }

  return 'relative'
}

async function resolveDiskPath(propostaId: string, row: AttachmentAuditRow) {
  const candidates = [
    resolveStoredProposalFilePath(row.caminho),
    row.nome_arquivo
      ? path.join(process.cwd(), 'public', 'uploads', 'propostas', propostaId, String(row.nome_arquivo))
      : null,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // tenta proximo
    }
  }

  return null
}

async function buildAttachmentAudit() {
  const rows = await query<AttachmentAuditRow[]>(
    `SELECT id, proposta_id, nome_arquivo, nome_original, caminho, conteudo, created_at
     FROM proposta_anexos
     ORDER BY created_at DESC`
  )

  const items: AttachmentAuditItem[] = []

  for (const row of rows) {
    const diskPath = await resolveDiskPath(row.proposta_id, row)
    const fileExistsOnDisk = Boolean(diskPath)
    const storageMode = inferStorageMode(row)
    const hasEmbeddedContent = Boolean(row.conteudo)
    const recoverable = hasEmbeddedContent || fileExistsOnDisk
    const risky = !recoverable

    items.push({
      id: row.id,
      propostaId: row.proposta_id,
      nomeArquivo: row.nome_arquivo,
      nomeOriginal: row.nome_original,
      caminho: row.caminho,
      storageMode: hasEmbeddedContent ? 'embedded' : storageMode,
      fileExistsOnDisk,
      recoverable,
      risky,
      createdAt: row.created_at,
    })
  }

  const summary = {
    total: items.length,
    embedded: items.filter((item) => item.storageMode === 'embedded').length,
    relative: items.filter((item) => item.storageMode === 'relative').length,
    absoluteLegacy: items.filter((item) => item.storageMode === 'absolute_legacy').length,
    missingPath: items.filter((item) => item.storageMode === 'missing_path').length,
    recoverable: items.filter((item) => item.recoverable).length,
    risky: items.filter((item) => item.risky).length,
  }

  return {
    summary,
    riskyItems: items.filter((item) => item.risky).slice(0, 100),
    legacyItems: items.filter((item) => item.storageMode === 'absolute_legacy').slice(0, 100),
  }
}

async function migrateLegacyAttachments() {
  const rows = await query<AttachmentAuditRow[]>(
    `SELECT id, proposta_id, nome_arquivo, nome_original, caminho, conteudo, created_at
     FROM proposta_anexos
     ORDER BY created_at DESC`
  )

  let migrated = 0
  let alreadySafe = 0
  const unresolved: Array<{ id: string; propostaId: string; caminho: string | null }> = []

  for (const row of rows) {
    if (row.conteudo && row.caminho && !path.isAbsolute(String(row.caminho))) {
      alreadySafe += 1
      continue
    }

    const diskPath = await resolveDiskPath(row.proposta_id, row)
    if (!diskPath) {
      if (!row.conteudo) {
        unresolved.push({
          id: row.id,
          propostaId: row.proposta_id,
          caminho: row.caminho,
        })
      } else {
        const normalizedPath = row.nome_arquivo
          ? toStoredRelativeProposalPath(row.proposta_id, String(row.nome_arquivo))
          : row.caminho

        await query(
          `UPDATE proposta_anexos
           SET caminho = COALESCE(?, caminho)
           WHERE id = ?`,
          [normalizedPath, row.id]
        )
        migrated += 1
      }
      continue
    }

    const buffer = await fs.readFile(diskPath)
    const normalizedPath = row.nome_arquivo
      ? toStoredRelativeProposalPath(row.proposta_id, String(row.nome_arquivo))
      : row.caminho

    await query(
      `UPDATE proposta_anexos
       SET conteudo = ?, caminho = COALESCE(?, caminho)
       WHERE id = ?`,
      [buffer, normalizedPath, row.id]
    )
    migrated += 1
  }

  return {
    migrated,
    alreadySafe,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100),
  }
}

export async function GET() {
  try {
    await ensureBaseSchema()

    const user = await getAdminUser()
    if (!user) {
      return NextResponse.json({ error: 'Apenas administradores podem auditar anexos.' }, { status: 403 })
    }

    const audit = await buildAttachmentAudit()
    return NextResponse.json(audit)
  } catch (error) {
    console.error('Erro ao auditar anexos de propostas:', error)
    return NextResponse.json({ error: 'Erro ao auditar anexos de propostas' }, { status: 500 })
  }
}

export async function POST() {
  try {
    await ensureBaseSchema()

    const user = await getAdminUser()
    if (!user) {
      return NextResponse.json({ error: 'Apenas administradores podem migrar anexos.' }, { status: 403 })
    }

    const result = await migrateLegacyAttachments()
    const audit = await buildAttachmentAudit()

    return NextResponse.json({
      migration: result,
      audit,
    })
  } catch (error) {
    console.error('Erro ao migrar anexos legados de propostas:', error)
    return NextResponse.json({ error: 'Erro ao migrar anexos legados de propostas' }, { status: 500 })
  }
}
