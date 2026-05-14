import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { formatDateTime } from '@/lib/server/proposal-workflow'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const INTERACOES_CACHE_TTL_MS = Math.max(Number(process.env.INTERACOES_CACHE_TTL_MS || 10_000), 1000)

const INTERACTION_SELECT_COLUMNS = `
  i.id,
  i.cliente_id,
  i.usuario_id,
  i.tipo,
  i.descricao,
  i.dados,
  i.proposta_id,
  i.novo_status,
  i.notification_kind,
  i.origem,
  i.silent_notification,
  i.created_at
`

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clienteId = searchParams.get('cliente_id')
  const tipo = searchParams.get('tipo')
  const limitParam = searchParams.get('limit')
  const notificationsOnly = searchParams.get('notifications_only') === 'true'
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 200) : null

  try {
    await ensureSystemDatabaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `interacoes:${user.role}:${user.id}:${clienteId || 'all'}:${tipo || 'all'}:${limit || 'all'}:${notificationsOnly ? 'notifications' : 'default'}`
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
      SELECT ${INTERACTION_SELECT_COLUMNS}, u.nome as usuario_nome
      FROM interacoes i
      LEFT JOIN usuarios u ON i.usuario_id = u.id
      LEFT JOIN propostas p ON p.id = i.proposta_id
      LEFT JOIN clientes c ON c.id = i.cliente_id
      ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC
    `

    if (notificationsOnly) {
      if (hasRuleAccess(user, 'canViewAllNotifications')) {
        // acesso total
      } else if (user.role === 'vendedor' || user.role === 'gerente') {
        whereClauses.push('(p.responsavel_id = ? OR (p.id IS NULL AND c.responsavel_id = ?))')
        params.push(user.id, user.id)
      } else if (user.role === 'orcamentista') {
        whereClauses.push('p.orcamentista_id = ?')
        params.push(user.id)
      }
    }

    sql = `
      SELECT ${INTERACTION_SELECT_COLUMNS}, u.nome as usuario_nome
      FROM interacoes i
      LEFT JOIN usuarios u ON i.usuario_id = u.id
      LEFT JOIN propostas p ON p.id = i.proposta_id
      LEFT JOIN clientes c ON c.id = i.cliente_id
      ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC
    `

    if (limit) {
      sql += ' LIMIT ?'
      params.push(limit)
    }

    const cachedInteracoes = getRuntimeCache<any[]>(cacheKey)
    if (cachedInteracoes !== undefined) {
      return NextResponse.json(cachedInteracoes)
    }

    const interacoes = await query(sql, params)
    setRuntimeCache(cacheKey, interacoes, INTERACOES_CACHE_TTL_MS)
    return NextResponse.json(interacoes)
  } catch (error) {
    console.error('Erro ao buscar interacoes:', error)

    if (isTransientDatabaseError(error)) {
      const fallbackUser = await getAuthenticatedServerUser().catch(() => null)
      const fallbackCacheKey = fallbackUser
        ? `interacoes:${fallbackUser.role}:${fallbackUser.id}:${clienteId || 'all'}:${tipo || 'all'}:${limit || 'all'}:${notificationsOnly ? 'notifications' : 'default'}`
        : null
      return NextResponse.json(
        (fallbackCacheKey ? getRuntimeCache<any[]>(fallbackCacheKey) : null) || [],
        { status: 200 }
      )
    }

    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemDatabaseSchema()
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

    const [interacao] = await query<any[]>(
      `SELECT ${INTERACTION_SELECT_COLUMNS}
       FROM interacoes i
       WHERE i.id = ?`,
      [id]
    )
    return NextResponse.json(interacao, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar interacao:', error)
    return NextResponse.json({ error: 'Erro ao criar interacao' }, { status: 500 })
  }
}
