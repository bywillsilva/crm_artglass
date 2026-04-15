import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { deleteStoredFiles } from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import {
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
