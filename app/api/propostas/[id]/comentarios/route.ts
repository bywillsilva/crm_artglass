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

async function getProposal(id: string) {
  return prisma.propostas.findUnique({
    where: { id },
    select: {
      id: true,
      cliente_id: true,
      numero: true,
      status: true,
      responsavel_id: true,
      orcamentista_id: true,
    },
  })
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const proposta = await getProposal(id)
    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canManageProposal(user, proposta)) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const data = await request.json()
    const comentario = String(data.comentario || '').trim()
    if (!comentario) {
      return NextResponse.json({ error: 'Comentario obrigatorio' }, { status: 400 })
    }

    const commentId = uuidv4()
    const savedComment = await prisma.$transaction(async (tx) => {
      await tx.proposta_comentarios.create({
        data: {
          id: commentId,
          proposta_id: id,
          usuario_id: user.id,
          comentario,
        },
      })

      await tx.$executeRawUnsafe('UPDATE propostas SET updated_at = NOW() WHERE id = ?', id)

      await tx.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: proposta.cliente_id,
          usuario_id: user.id,
          tipo: 'proposta',
          descricao: `Comentario registrado na proposta ${proposta.numero || 'sem numero'}`,
          dados: JSON.stringify({
            proposta_id: id,
            comment_id: commentId,
            silent_notification: true,
            origin: 'proposal_comment',
          }),
          created_at: new Date(),
        } as any,
      })

      const comment = await tx.proposta_comentarios.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          proposta_id: true,
          usuario_id: true,
          comentario: true,
          created_at: true,
          usuarios: {
            select: { nome: true },
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
            usuario_nome: comment.usuarios?.nome || null,
          }
        : null
    })

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('crm-bootstrap:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta_comentario',
      resourceId: commentId,
    })

    return NextResponse.json(savedComment, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar comentario da proposta:', error)
    return NextResponse.json({ error: 'Erro ao criar comentario da proposta' }, { status: 500 })
  }
}
