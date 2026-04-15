import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getServerSession } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import {
  ensureCrmRuntimeSchema,
  formatDateTime,
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

export async function GET(request: NextRequest) {
  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const tipo = searchParams.get('tipo')
    const responsavel =
      user.role === 'admin' || user.role === 'gerente'
        ? searchParams.get('responsavel')
        : user.id
    const clienteId = searchParams.get('cliente_id')

    let sql = `
      SELECT t.*, c.nome as cliente_nome, u.nome as responsavel_nome
      FROM tarefas t
      LEFT JOIN clientes c ON t.cliente_id = c.id
      LEFT JOIN usuarios u ON t.responsavel_id = u.id
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND t.status = ?'
      params.push(status)
    }

    if (tipo && tipo !== 'todos') {
      sql += ' AND t.tipo = ?'
      params.push(tipo)
    }

    if (responsavel && responsavel !== 'todos') {
      sql += ' AND t.responsavel_id = ?'
      params.push(responsavel)
    }

    if (clienteId) {
      sql += ' AND t.cliente_id = ?'
      params.push(clienteId)
    }

    sql += ' ORDER BY t.data_hora ASC'

    const tarefas = await query(sql, params)
    return NextResponse.json(tarefas)
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error)
    return NextResponse.json({ error: 'Erro ao buscar tarefas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()
    const now = new Date()

    await query(
      `INSERT INTO tarefas (id, titulo, descricao, tipo, data_hora, status, cliente_id, responsavel_id, proposta_id, automacao_etapa, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.titulo || data.descricao || 'Tarefa',
        data.descricao || null,
        data.tipo || 'ligacao',
        data.dataHora,
        data.status || 'pendente',
        data.clienteId,
        data.responsavelId,
        data.propostaId || null,
        data.automacaoEtapa || null,
        data.origem || 'manual',
      ]
    )

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'tarefa', ?, ?, ?)`,
      [
        uuidv4(),
        data.clienteId,
        user.id,
        `Tarefa criada: ${data.titulo || data.descricao || 'Tarefa'}`,
        JSON.stringify({ tarefa_id: id, origem: data.origem || 'manual' }),
        formatDateTime(now),
      ]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'tarefa',
      resourceId: id,
    })

    const [tarefa] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])
    return NextResponse.json(tarefa, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao criar tarefa' }, { status: 500 })
  }
}
