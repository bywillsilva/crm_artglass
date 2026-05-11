import { promises as fs } from 'fs'
import path, { basename } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { getServerSession } from '@/lib/auth/session'
import {
  deleteStoredFiles,
  resolveStoredProposalFilePath,
  toStoredRelativeProposalPath,
} from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'
import {
  canOrcamentistaAccessProposal,
  canOrcamentistaViewProposal,
} from '@/lib/server/proposal-workflow'

const SELLER_VISIBLE_STATUSES = new Set([
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'aguardando_follow_up_3_dias',
  'follow_up_3_dias',
  'aguardando_follow_up_7_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'perdido',
])

async function getAuthenticatedUser() {
  const session = await getServerSession()
  if (!session) return null

  const [user] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [session.userId]
  )

  if (!user || !user.ativo) return null
  return user
}

async function getProposal(id: string) {
  const [proposta] = await query<any[]>(
    `SELECT id, status, responsavel_id, orcamentista_id
     FROM propostas
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  return proposta
}

function canViewProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return proposta.responsavel_id === user.id && SELLER_VISIBLE_STATUSES.has(String(proposta.status || ''))
  }
  if (user.role === 'orcamentista') return canOrcamentistaViewProposal(proposta, user.id)
  return false
}

function canSellerManageProposal(proposta: any, userId: string) {
  return (
    proposta.responsavel_id === userId &&
    [
      'enviar_ao_cliente',
      'enviado_ao_cliente',
      'follow_up_1_dia',
      'aguardando_follow_up_3_dias',
      'follow_up_3_dias',
      'aguardando_follow_up_7_dias',
      'follow_up_7_dias',
      'stand_by',
      'fechado',
      'perdido',
    ].includes(String(proposta.status || ''))
  )
}

function canManageProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') return canSellerManageProposal(proposta, user.id)
  if (user.role === 'orcamentista') return canOrcamentistaAccessProposal(proposta, user.id)
  return false
}

function buildAttachmentFileName(attachment: any) {
  const originalName = String(attachment.nome_original || '').trim()
  if (originalName) {
    return originalName
  }

  return basename(String(attachment.caminho || 'anexo'))
}

async function touchProposalUpdatedAt(propostaId: string) {
  await query('UPDATE propostas SET updated_at = NOW() WHERE id = ?', [propostaId])
}

async function backfillAttachmentStorage(
  attachmentId: string,
  propostaId: string,
  nomeArquivo: string | null | undefined,
  fileBuffer: Buffer
) {
  const nextPath = nomeArquivo
    ? toStoredRelativeProposalPath(propostaId, String(nomeArquivo))
    : null

  await query(
    `UPDATE proposta_anexos
     SET conteudo = ?, caminho = COALESCE(?, caminho)
     WHERE id = ?`,
    [fileBuffer, nextPath, attachmentId]
  )
}

async function resolveStoredAttachmentPath(propostaId: string, attachment: any) {
  const legacyFileNameFromPath =
    typeof attachment.caminho === 'string' && attachment.caminho.trim()
      ? basename(String(attachment.caminho))
      : null

  const candidates = [
    resolveStoredProposalFilePath(attachment.caminho),
    attachment.nome_arquivo
      ? path.join(process.cwd(), 'public', 'uploads', 'propostas', propostaId, String(attachment.nome_arquivo))
      : null,
    legacyFileNameFromPath
      ? path.join(process.cwd(), 'public', 'uploads', 'propostas', propostaId, legacyFileNameFromPath)
      : null,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Tenta o proximo caminho possivel.
    }
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, attachmentId } = await params
    const proposta = await getProposal(id)
    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canViewProposal(user, proposta)) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const [attachment] = await query<any[]>(
      `SELECT id, proposta_id, caminho, nome_arquivo, nome_original, tipo_mime, conteudo
       FROM proposta_anexos
       WHERE id = ?
       LIMIT 1`,
      [attachmentId]
    )

    if (!attachment || attachment.proposta_id !== id) {
      return NextResponse.json({ error: 'Anexo nao encontrado' }, { status: 404 })
    }

    let fileBuffer: Buffer | null = null
    const resolvedPath = await resolveStoredAttachmentPath(id, attachment)
    if (resolvedPath) {
      fileBuffer = await fs.readFile(resolvedPath)
      if (!attachment.conteudo) {
        await backfillAttachmentStorage(
          attachment.id,
          id,
          attachment.nome_arquivo,
          fileBuffer
        )
      }
    } else if (attachment.conteudo) {
      fileBuffer = Buffer.isBuffer(attachment.conteudo)
        ? attachment.conteudo
        : Buffer.from(attachment.conteudo)
    }

    if (!fileBuffer) {
      return NextResponse.json({ error: 'Arquivo do anexo nao foi encontrado no servidor' }, { status: 404 })
    }

    const fileName = buildAttachmentFileName(attachment)

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.tipo_mime || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    console.error('Erro ao abrir anexo da proposta:', error)
    return NextResponse.json({ error: 'Erro ao abrir anexo da proposta' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, attachmentId } = await params
    const proposta = await getProposal(id)
    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canManageProposal(user, proposta)) {
      return NextResponse.json({ error: 'Voce nao pode excluir anexos desta proposta' }, { status: 403 })
    }

    const [attachment] = await query<any[]>(
      `SELECT id, proposta_id, usuario_id, caminho
       FROM proposta_anexos
       WHERE id = ?
       LIMIT 1`,
      [attachmentId]
    )

    if (!attachment || attachment.proposta_id !== id) {
      return NextResponse.json({ error: 'Anexo nao encontrado' }, { status: 404 })
    }

    if (
      user.role !== 'admin' &&
      user.role !== 'gerente' &&
      attachment.usuario_id !== user.id
    ) {
      return NextResponse.json({ error: 'Voce nao pode excluir este anexo' }, { status: 403 })
    }

    await query('DELETE FROM proposta_anexos WHERE id = ?', [attachmentId])
    await touchProposalUpdatedAt(id)
    await deleteStoredFiles([attachment.caminho])
    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('crm-bootstrap:')

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta_anexo',
      resourceId: attachmentId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao excluir anexo da proposta:', error)
    return NextResponse.json({ error: 'Erro ao excluir anexo da proposta' }, { status: 500 })
  }
}
