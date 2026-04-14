import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import {
  canOrcamentistaAccessProposal,
  ensureClientSchema,
  ensureProposalStatusSchema,
  ensureResponsibilityIntegrity,
  ensureTaskSchema,
  ensureUserRoleSchema,
} from '@/lib/server/proposal-workflow'

async function ensureBaseSchema() {
  await ensureUserRoleSchema()
  await ensureClientSchema()
  await ensureProposalStatusSchema()
  await ensureTaskSchema()
  await ensureResponsibilityIntegrity()
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
    `SELECT id, cliente_id, numero, status, responsavel_id, orcamentista_id
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
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
  }
  return false
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const proposta = await getProposal(id)
    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canViewProposal(user, proposta)) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const data = await request.json()
    const comentario = String(data.comentario || '').trim()
    if (!comentario) {
      return NextResponse.json({ error: 'Comentario obrigatorio' }, { status: 400 })
    }

    const commentId = uuidv4()
    await query(
      `INSERT INTO proposta_comentarios (id, proposta_id, usuario_id, comentario)
       VALUES (?, ?, ?, ?)`,
      [commentId, id, user.id, comentario]
    )

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'proposta', ?, ?, NOW())`,
      [
        uuidv4(),
        proposta.cliente_id,
        user.id,
        `Comentario registrado na proposta ${proposta.numero || 'sem numero'}`,
        JSON.stringify({
          proposta_id: id,
          comment_id: commentId,
          silent_notification: true,
          origin: 'proposal_comment',
        }),
      ]
    )

    const [savedComment] = await query<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.id = ?
       LIMIT 1`,
      [commentId]
    )

    return NextResponse.json(savedComment, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar comentario da proposta:', error)
    return NextResponse.json({ error: 'Erro ao criar comentario da proposta' }, { status: 500 })
  }
}
