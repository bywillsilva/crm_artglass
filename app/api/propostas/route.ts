import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getServerSession } from '@/lib/auth/session'
import {
  ensureResponsibilityIntegrity,
  ensureProposalStatusSchema,
  ensureTaskSchema,
  formatDateTime,
  handleProposalAutomationOnCreate,
  normalizeProposalStatus,
} from '@/lib/server/proposal-workflow'

export async function GET(request: NextRequest) {
  try {
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const clienteId = searchParams.get('cliente_id')
    const responsavelId =
      session.role === 'admin'
        ? searchParams.get('responsavel_id')
        : session.userId

    let sql = `
      SELECT p.*, c.nome as cliente_nome, u.nome as responsavel_nome
      FROM propostas p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN usuarios u ON p.responsavel_id = u.id
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND p.status = ?'
      params.push(status)
    }

    if (clienteId) {
      sql += ' AND p.cliente_id = ?'
      params.push(clienteId)
    }

    if (responsavelId) {
      sql += ' AND p.responsavel_id = ?'
      params.push(responsavelId)
    }

    sql += ' ORDER BY p.created_at DESC'

    const propostas = await query(sql, params)
    return NextResponse.json(propostas)
  } catch (error) {
    console.error('Erro ao buscar propostas:', error)
    return NextResponse.json({ error: 'Erro ao buscar propostas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()
    const now = new Date()
    const status = normalizeProposalStatus(data.status)
    const responsavelId = session.role === 'admin' ? data.responsavelId : session.userId

    if (!responsavelId) {
      return NextResponse.json(
        { error: 'Selecione um responsavel para criar a proposta.' },
        { status: 400 }
      )
    }

    const [responsavel] = await query<any[]>(
      'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
      [responsavelId]
    )

    if (!responsavel || !responsavel.ativo || responsavel.role === 'admin') {
      return NextResponse.json(
        { error: 'O responsavel informado para a proposta e invalido.' },
        { status: 400 }
      )
    }

    const [countResult] = await query<any[]>('SELECT COUNT(*) as total FROM propostas')
    const numero = `PROP-${new Date().getFullYear()}-${String(countResult.total + 1).padStart(3, '0')}`

    const valorFinal = data.valor - (data.valor * (data.desconto || 0) / 100)

    await query(
      `INSERT INTO propostas (
        id, numero, cliente_id, responsavel_id, titulo, descricao,
        valor, desconto, valor_final, status, validade, servicos, condicoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        numero,
        data.clienteId,
        responsavelId,
        data.titulo,
        data.descricao || null,
        data.valor,
        data.desconto || 0,
        valorFinal,
        status,
        data.validade || null,
        JSON.stringify(data.servicos || []),
        data.condicoes || null,
      ]
    )

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
      [
        uuidv4(),
        data.clienteId,
        session.userId,
        `Proposta ${numero} criada em ${status}`,
        JSON.stringify({ proposta_id: id, status }),
        formatDateTime(now),
      ]
    )

    await handleProposalAutomationOnCreate({
      clienteId: data.clienteId,
      responsavelId,
      propostaId: id,
      status,
      createdAt: now,
    })

    const [proposta] = await query<any[]>('SELECT * FROM propostas WHERE id = ?', [id])
    return NextResponse.json(proposta, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar proposta:', error)
    return NextResponse.json({ error: 'Erro ao criar proposta' }, { status: 500 })
  }
}
