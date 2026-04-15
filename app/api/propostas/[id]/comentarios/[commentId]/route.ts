import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
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

async function getComment(commentId: string) {
  const [comment] = await query<any[]>(
    `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, p.cliente_id, p.numero, p.status, p.responsavel_id, p.orcamentista_id
     FROM proposta_comentarios pc
     INNER JOIN propostas p ON p.id = pc.proposta_id
     WHERE pc.id = ?
     LIMIT 1`,
    [commentId]
  )

  return comment
}

function canViewProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') return proposta.responsavel_id === user.id
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
  }
  return false
}

function canManageComment(user: any, comment: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  return comment.usuario_id === user.id
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, commentId } = await params
    const comment = await getComment(commentId)
    if (!comment || comment.proposta_id !== id) {
      return NextResponse.json({ error: 'Comentario nao encontrado' }, { status: 404 })
    }

    if (!canViewProposal(user, comment) || !canManageComment(user, comment)) {
      return NextResponse.json({ error: 'Voce nao pode alterar este comentario' }, { status: 403 })
    }

    const data = await request.json()
    const comentario = String(data.comentario || '').trim()
    if (!comentario) {
      return NextResponse.json({ error: 'Comentario obrigatorio' }, { status: 400 })
    }

    await query('UPDATE proposta_comentarios SET comentario = ? WHERE id = ?', [
      comentario,
      commentId,
    ])

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'proposta', ?, ?, NOW())`,
      [
        uuidv4(),
        comment.cliente_id,
        user.id,
        `Comentario atualizado na proposta ${comment.numero || 'sem numero'}`,
        JSON.stringify({
          proposta_id: id,
          comment_id: commentId,
          silent_notification: true,
          origin: 'proposal_comment_edit',
        }),
      ]
    )

    const [updatedComment] = await query<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.id = ?
       LIMIT 1`,
      [commentId]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta_comentario',
      resourceId: commentId,
    })

    return NextResponse.json(updatedComment)
  } catch (error) {
    console.error('Erro ao atualizar comentario da proposta:', error)
    return NextResponse.json({ error: 'Erro ao atualizar comentario da proposta' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, commentId } = await params
    const comment = await getComment(commentId)
    if (!comment || comment.proposta_id !== id) {
      return NextResponse.json({ error: 'Comentario nao encontrado' }, { status: 404 })
    }

    if (!canViewProposal(user, comment) || !canManageComment(user, comment)) {
      return NextResponse.json({ error: 'Voce nao pode excluir este comentario' }, { status: 403 })
    }

    await query('DELETE FROM proposta_comentarios WHERE id = ?', [commentId])

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'proposta', ?, ?, NOW())`,
      [
        uuidv4(),
        comment.cliente_id,
        user.id,
        `Comentario removido da proposta ${comment.numero || 'sem numero'}`,
        JSON.stringify({
          proposta_id: id,
          comment_id: commentId,
          silent_notification: true,
          origin: 'proposal_comment_delete',
        }),
      ]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta_comentario',
      resourceId: commentId,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao excluir comentario da proposta:', error)
    return NextResponse.json({ error: 'Erro ao excluir comentario da proposta' }, { status: 500 })
  }
}
