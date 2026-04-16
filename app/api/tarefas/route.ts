import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import {
  ensureCrmRuntimeSchema,
  formatDateTime,
} from '@/lib/server/proposal-workflow'

const TAREFAS_CACHE_TTL_MS = Math.max(Number(process.env.TAREFAS_CACHE_TTL_MS || 30_000), 1000)

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const tipo = searchParams.get('tipo')
  const clienteId = searchParams.get('cliente_id')
  const updatedSince = searchParams.get('updated_since')

  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const responsavel =
      user.role === 'admin' || user.role === 'gerente'
        ? searchParams.get('responsavel')
        : user.id
    const cacheKey = `tarefas:list:${user.id}:${user.role}:${status || 'todos'}:${tipo || 'todos'}:${responsavel || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
    const cachedTarefas = getRuntimeCache<any[]>(cacheKey)
    if (cachedTarefas !== undefined) {
      return NextResponse.json(cachedTarefas)
    }

    let sql = `
      SELECT
        t.*,
        COALESCE(t.cliente_id, p.cliente_id) as cliente_id_resolvido,
        c.nome as cliente_nome,
        u.nome as responsavel_nome
      FROM tarefas t
      LEFT JOIN propostas p ON t.proposta_id = p.id
      LEFT JOIN clientes c ON COALESCE(t.cliente_id, p.cliente_id) = c.id
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

    if (updatedSince) {
      sql += ' AND t.updated_at >= ?'
      params.push(updatedSince)
    }

    sql += ' ORDER BY t.data_hora ASC'

    const tarefas = await query(sql, params)
    setRuntimeCache(cacheKey, tarefas, TAREFAS_CACHE_TTL_MS)
    return NextResponse.json(tarefas)
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
      }

      const responsavel =
        user.role === 'admin' || user.role === 'gerente'
          ? searchParams.get('responsavel')
          : user.id
      const cacheKey = `tarefas:list:${user.id}:${user.role}:${status || 'todos'}:${tipo || 'todos'}:${responsavel || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
      return NextResponse.json(getRuntimeCache<any[]>(cacheKey) || [], { status: 200 })
    }

    return NextResponse.json({ error: 'Erro ao buscar tarefas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
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
