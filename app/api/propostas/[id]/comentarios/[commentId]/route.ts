import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/db/prisma'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'
import {
  canOrcamentistaAccessProposal,
} from '@/lib/server/proposal-workflow'

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

async function getComment(commentId: string) {
  const comment = await prisma.proposta_comentarios.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      proposta_id: true,
      usuario_id: true,
      comentario: true,
      created_at: true,
      propostas: {
        select: {
          cliente_id: true,
          numero: true,
          status: true,
          responsavel_id: true,
          orcamentista_id: true,
        },
      },
    },
  })

  return comment
    ? {
        id: comment.id,
        proposta_id: comment.proposta_id,
        usuario_id: comment.usuario_id,
        comentario: comment.comentario,
        created_at: comment.created_at,
        cliente_id: comment.propostas.cliente_id,
        numero: comment.propostas.numero,
        status: comment.propostas.status,
        responsavel_id: comment.propostas.responsavel_id,
        orcamentista_id: comment.propostas.orcamentista_id,
      }
    : null
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
  if (user.role === 'vendedor') {
    return (
      hasRuleAccess(user, 'allowSellerCommentsOnResponsibleProposals') &&
      canSellerManageProposal(proposta, user.id)
    )
  }
  if (user.role === 'orcamentista') {
    return (
      canOrcamentistaAccessProposal(proposta, user.id) ||
      (hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
        proposta.orcamentista_id === user.id)
    )
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
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, commentId } = await params
    const comment = await getComment(commentId)
    if (!comment || comment.proposta_id !== id) {
      return NextResponse.json({ error: 'Comentario nao encontrado' }, { status: 404 })
    }

    if (!canManageProposal(user, comment) || !canManageComment(user, comment)) {
      return NextResponse.json({ error: 'Voce nao pode alterar este comentario' }, { status: 403 })
    }

    const data = await request.json()
    const comentario = String(data.comentario || '').trim()
    if (!comentario) {
      return NextResponse.json({ error: 'Comentario obrigatorio' }, { status: 400 })
    }

    const updatedComment = await prisma.$transaction(async (tx) => {
      await tx.proposta_comentarios.update({
        where: { id: commentId },
        data: { comentario },
      })
      await tx.$executeRawUnsafe('UPDATE propostas SET updated_at = NOW() WHERE id = ?', id)
      await tx.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: comment.cliente_id,
          usuario_id: user.id,
          tipo: 'proposta',
          descricao: `Comentario atualizado na proposta ${comment.numero || 'sem numero'}`,
          dados: JSON.stringify({
            proposta_id: id,
            comment_id: commentId,
            silent_notification: true,
            origin: 'proposal_comment_edit',
          }),
          created_at: new Date(),
        } as any,
      })

      const saved = await tx.proposta_comentarios.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          proposta_id: true,
          usuario_id: true,
          comentario: true,
          created_at: true,
          usuarios: { select: { nome: true } },
        },
      })

      return saved
        ? {
            id: saved.id,
            proposta_id: saved.proposta_id,
            usuario_id: saved.usuario_id,
            comentario: saved.comentario,
            created_at: saved.created_at,
            usuario_nome: saved.usuarios?.nome || null,
          }
        : null
    })

    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('crm-bootstrap:')
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
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id, commentId } = await params
    const comment = await getComment(commentId)
    if (!comment || comment.proposta_id !== id) {
      return NextResponse.json({ error: 'Comentario nao encontrado' }, { status: 404 })
    }

    if (!canManageProposal(user, comment) || !canManageComment(user, comment)) {
      return NextResponse.json({ error: 'Voce nao pode excluir este comentario' }, { status: 403 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.proposta_comentarios.delete({ where: { id: commentId } })
      await tx.$executeRawUnsafe('UPDATE propostas SET updated_at = NOW() WHERE id = ?', id)
      await tx.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: comment.cliente_id,
          usuario_id: user.id,
          tipo: 'proposta',
          descricao: `Comentario removido da proposta ${comment.numero || 'sem numero'}`,
          dados: JSON.stringify({
            proposta_id: id,
            comment_id: commentId,
            silent_notification: true,
            origin: 'proposal_comment_delete',
          }),
          created_at: new Date(),
        } as any,
      })
    })

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
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
