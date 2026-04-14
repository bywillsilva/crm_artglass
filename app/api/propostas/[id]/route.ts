import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import {
  ensureResponsibilityIntegrity,
  ensureProposalStatusSchema,
  ensureTaskSchema,
  formatDateTime,
  normalizeProposalStatus,
  syncProposalAutomation,
} from '@/lib/server/proposal-workflow'

async function getAuthenticatedUser() {
  const session = await getServerSession()
  if (!session) {
    return null
  }

  const [user] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [session.userId]
  )

  if (!user || !user.ativo) {
    return null
  }

  return user
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const [proposta] = await query<any[]>(
      `SELECT p.*, c.nome as cliente_nome, u.nome as responsavel_nome
       FROM propostas p
       LEFT JOIN clientes c ON p.cliente_id = c.id
       LEFT JOIN usuarios u ON p.responsavel_id = u.id
       WHERE p.id = ?`,
      [id]
    )

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && proposta.responsavel_id !== user.id) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    return NextResponse.json(proposta)
  } catch (error) {
    console.error('Erro ao buscar proposta:', error)
    return NextResponse.json({ error: 'Erro ao buscar proposta' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const changedAt = new Date()

    const [propostaAtual] = await query<any[]>('SELECT * FROM propostas WHERE id = ?', [id])

    if (!propostaAtual) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && propostaAtual.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela proposta ou o administrador podem altera-la' },
        { status: 403 }
      )
    }

    const status = normalizeProposalStatus(data.status ?? propostaAtual.status)
    const responsavelId = propostaAtual.responsavel_id || user.id
    const valor = Number(data.valor ?? propostaAtual.valor ?? 0)
    const desconto = Number(data.desconto ?? propostaAtual.desconto ?? 0)
    const valorFinal = valor - (valor * desconto) / 100
    const servicos =
      Array.isArray(data.servicos)
        ? data.servicos
        : typeof data.servicos === 'string'
          ? JSON.parse(data.servicos)
          : typeof propostaAtual.servicos === 'string'
            ? JSON.parse(propostaAtual.servicos || '[]')
            : propostaAtual.servicos || []

    await query(
      `UPDATE propostas SET
        titulo = ?, descricao = ?, valor = ?, desconto = ?,
        valor_final = ?, status = ?, validade = ?, servicos = ?, condicoes = ?, responsavel_id = ?
      WHERE id = ?`,
      [
        data.titulo || propostaAtual.titulo || 'Proposta Comercial',
        data.descricao ?? propostaAtual.descricao ?? null,
        valor,
        desconto,
        valorFinal,
        status,
        data.validade || propostaAtual.validade || null,
        JSON.stringify(servicos),
        data.condicoes ?? propostaAtual.condicoes ?? null,
        responsavelId,
        id,
      ]
    )

    if (normalizeProposalStatus(propostaAtual.status) !== status) {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
        [
          uuidv4(),
          propostaAtual.cliente_id,
          user.id,
          `Proposta ${propostaAtual.numero} alterada para ${status}`,
          JSON.stringify({ proposta_id: id, novo_status: status }),
          formatDateTime(changedAt),
        ]
      )

      await syncProposalAutomation({
        propostaId: id,
        clienteId: propostaAtual.cliente_id,
        responsavelId,
        newStatus: status,
        changedAt,
      })
    } else {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
        [
          uuidv4(),
          propostaAtual.cliente_id,
          user.id,
          `Proposta ${propostaAtual.numero} atualizada`,
          JSON.stringify({ proposta_id: id, origem: 'edicao_proposta' }),
          formatDateTime(changedAt),
        ]
      )
    }

    const [proposta] = await query<any[]>('SELECT * FROM propostas WHERE id = ?', [id])
    return NextResponse.json(proposta)
  } catch (error) {
    console.error('Erro ao atualizar proposta:', error)
    return NextResponse.json({ error: 'Erro ao atualizar proposta' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const [proposta] = await query<any[]>(
      'SELECT id, responsavel_id FROM propostas WHERE id = ? LIMIT 1',
      [id]
    )

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && proposta.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela proposta ou o administrador podem exclui-la' },
        { status: 403 }
      )
    }

    await query('DELETE FROM propostas WHERE id = ?', [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar proposta:', error)
    return NextResponse.json({ error: 'Erro ao deletar proposta' }, { status: 500 })
  }
}
