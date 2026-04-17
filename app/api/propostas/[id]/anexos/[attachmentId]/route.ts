import { promises as fs } from 'fs'
import { basename } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { getServerSession } from '@/lib/auth/session'
import { deleteStoredFiles } from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'
import {
  canOrcamentistaAccessProposal,
  ensureCrmRuntimeSchema,
} from '@/lib/server/proposal-workflow'

async function ensureBaseSchema() {
  await ensureCrmRuntimeSchema()
}

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
  if (user.role === 'vendedor') return proposta.responsavel_id === user.id
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    await ensureBaseSchema()

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
      `SELECT id, proposta_id, caminho, nome_original, tipo_mime
       FROM proposta_anexos
       WHERE id = ?
       LIMIT 1`,
      [attachmentId]
    )

    if (!attachment || attachment.proposta_id !== id) {
      return NextResponse.json({ error: 'Anexo nao encontrado' }, { status: 404 })
    }

    const fileBuffer = await fs.readFile(String(attachment.caminho))
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
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, attachmentId } = await params
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
    await deleteStoredFiles([attachment.caminho])
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
