import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/server/proposal-workflow'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const INTERACOES_CACHE_TTL_MS = Math.max(Number(process.env.INTERACOES_CACHE_TTL_MS || 10_000), 1000)

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clienteId = searchParams.get('cliente_id')
    const tipo = searchParams.get('tipo')
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 200) : null
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (clienteId) {
      whereClauses.push('i.cliente_id = ?')
      params.push(clienteId)
    }

    if (tipo) {
      whereClauses.push('i.tipo = ?')
      params.push(tipo)
    }

    let sql = `
      SELECT i.*, u.nome as usuario_nome
      FROM interacoes i
      LEFT JOIN usuarios u ON i.usuario_id = u.id
      ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC
    `

    if (limit) {
      sql += ' LIMIT ?'
      params.push(limit)
    }

    const cacheKey = `interacoes:${clienteId || 'all'}:${tipo || 'all'}:${limit || 'all'}`
    const cachedInteracoes = getRuntimeCache<any[]>(cacheKey)
    if (cachedInteracoes !== undefined) {
      return NextResponse.json(cachedInteracoes)
    }

    const interacoes = await query(sql, params)
    setRuntimeCache(cacheKey, interacoes, INTERACOES_CACHE_TTL_MS)
    return NextResponse.json(interacoes)
  } catch (error) {
    console.error('Erro ao buscar interacoes:', error)
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.clienteId,
        user.id,
        data.tipo,
        data.descricao,
        data.dados ? JSON.stringify(data.dados) : null,
        formatDateTime(new Date()),
      ]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'interacao',
      resourceId: id,
    })

    invalidateRuntimeCache(`interacoes:${data.clienteId || 'all'}:`)
    invalidateRuntimeCache('interacoes:all:')

    const [interacao] = await query<any[]>('SELECT * FROM interacoes WHERE id = ?', [id])
    return NextResponse.json(interacao, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar interacao:', error)
    return NextResponse.json({ error: 'Erro ao criar interacao' }, { status: 500 })
  }
}
