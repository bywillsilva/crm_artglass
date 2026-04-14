import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getServerSession } from '@/lib/auth/session'
import {
  ensureClientSchema,
  getNextProposalNumber,
  ensureProposalStatusSchema,
  ensureResponsibilityIntegrity,
  ensureTaskSchema,
  ensureUserRoleSchema,
  formatDateTime,
} from '@/lib/server/proposal-workflow'

async function ensureBaseSchema() {
  await ensureUserRoleSchema()
  await ensureClientSchema()
  await ensureProposalStatusSchema()
  await ensureTaskSchema()
  await ensureResponsibilityIntegrity()
}

async function getDefaultProposalResponsavel(userId: string) {
  const [currentUser] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [userId]
  )

  if (currentUser?.ativo && ['vendedor', 'gerente'].includes(currentUser.role)) {
    return currentUser.id as string
  }

  const [fallbackSeller] = await query<any[]>(
    `SELECT id
     FROM usuarios
     WHERE ativo = TRUE
       AND role IN ('vendedor', 'gerente')
     ORDER BY created_at ASC
     LIMIT 1`
  )

  return (fallbackSeller?.id || userId) as string
}

async function getDefaultProposalOrcamentista(userId: string) {
  const [currentUser] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [userId]
  )

  if (currentUser?.ativo && currentUser.role === 'orcamentista') {
    return currentUser.id as string
  }

  const [fallbackOrcamentista] = await query<any[]>(
    `SELECT id
     FROM usuarios
     WHERE ativo = TRUE
       AND role = 'orcamentista'
     ORDER BY created_at ASC
     LIMIT 1`
  )

  return (fallbackOrcamentista?.id || null) as string | null
}

async function createInitialProposalForClient(params: {
  clienteId: string
  clienteNome: string
  usuarioId: string
}) {
  const propostaId = uuidv4()
  const responsavelId = await getDefaultProposalResponsavel(params.usuarioId)
  const orcamentistaId = await getDefaultProposalOrcamentista(params.usuarioId)
  const numero = await getNextProposalNumber()

  await query(
    `INSERT INTO propostas (
      id, numero, cliente_id, responsavel_id, orcamentista_id, retificacoes_count, titulo, descricao,
      valor, desconto, valor_final, status, validade, servicos, condicoes, follow_up_base_at, follow_up_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      propostaId,
      numero,
      params.clienteId,
      responsavelId,
      orcamentistaId,
      0,
      `Novo cliente - ${params.clienteNome}`,
      null,
      0,
      0,
      0,
      'novo_cliente',
      null,
      JSON.stringify([]),
      null,
      null,
      null,
    ]
  )

  await query(
    `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
     VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
    [
      uuidv4(),
      params.clienteId,
      params.usuarioId,
      `Card inicial da proposta criado automaticamente para o novo cliente`,
      JSON.stringify({
        proposta_id: propostaId,
        status: 'novo_cliente',
        origem: 'cliente_novo',
        silent_notification: true,
      }),
      formatDateTime(new Date()),
    ]
  )
}

export async function GET(request: NextRequest) {
  try {
    await ensureBaseSchema()
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    let sql = `
      SELECT c.*
      FROM clientes c
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND c.status_funil = ?'
      params.push(status)
    }

    if (search) {
      sql += ' AND (c.nome LIKE ? OR c.email LIKE ? OR c.empresa LIKE ?)'
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    sql += ' ORDER BY c.created_at DESC'

    const clientes = await query(sql, params)
    return NextResponse.json(clientes)
  } catch (error) {
    console.error('Erro ao buscar clientes:', error)
    return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureBaseSchema()
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()

    await query(
      `INSERT INTO clientes (
        id, nome, email, telefone, empresa, cargo, endereco, cidade, estado, cep,
        origem, status_funil, valor_potencial, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.nome,
        data.email || null,
        data.telefone || null,
        data.empresa || null,
        data.cargo || null,
        data.endereco || null,
        data.cidade || null,
        data.estado || null,
        data.cep || null,
        data.origem || null,
        data.statusFunil || 'lead_novo',
        data.valorPotencial || 0,
        data.observacoes || null,
      ]
    )

    // Criar interação de registro
    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, created_at) 
       VALUES (?, ?, ?, 'nota', 'Cliente cadastrado no sistema', ?)`,
      [uuidv4(), id, session.userId, formatDateTime(new Date())]
    )

    await createInitialProposalForClient({
      clienteId: id,
      clienteNome: data.nome,
      usuarioId: session.userId,
    })

    const [cliente] = await query<any[]>('SELECT * FROM clientes WHERE id = ?', [id])
    return NextResponse.json(cliente, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar cliente:', error)
    return NextResponse.json({ error: 'Erro ao criar cliente' }, { status: 500 })
  }
}
