import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser, getServerSession } from '@/lib/auth/session'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { jsonNoStore } from '@/lib/server/http-cache'

const DASHBOARD_CACHE_TTL_MS = Math.max(Number(process.env.DASHBOARD_CACHE_TTL_MS || 20_000), 1000)

const DASHBOARD_TASK_SELECT_COLUMNS = `
  t.id,
  t.titulo,
  t.data_hora,
  t.cliente_id,
  COALESCE(t.cliente_id, p.cliente_id) as cliente_id_resolvido,
  c.nome as cliente_nome
`

const DASHBOARD_CLIENT_ALERT_SELECT_COLUMNS = `
  c.id,
  c.nome,
  c.status_funil,
  c.updated_at
`

const DASHBOARD_PROPOSAL_ALERT_SELECT_COLUMNS = `
  p.id,
  p.numero,
  p.cliente_id,
  p.valor,
  p.valor_final,
  p.status,
  p.updated_at,
  c.nome as cliente_nome
`

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

function getDateRange(request: NextRequest) {
  const startDate = request.nextUrl.searchParams.get('startDate')
  const endDate = request.nextUrl.searchParams.get('endDate')

  if (!startDate || !endDate) {
    return null
  }

  if (startDate <= endDate) {
    return { startDate, endDate }
  }

  return { startDate: endDate, endDate: startDate }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  const dateRange = getDateRange(request)
  const defaults = {
    stats: {
      totalLeads: 0,
      taxaConversao: 0,
      valorPipeline: 0,
      vendasMes: 0,
    },
    funilData: [],
    vendasPorMes: [],
    rankingVendedores: [],
    tarefasPeriodo: [],
    alertas: {
      tarefasAtrasadas: [],
      clientesSemTarefa: [],
      propostasEmAberto: [],
    },
  }

  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }

    const isAdmin = user.role === 'admin' || user.role === 'gerente'
    const cacheKey = `dashboard:${user.role}:${user.id}:${dateRange?.startDate || 'all'}:${dateRange?.endDate || 'all'}`
    const cachedResponse = getRuntimeCache<any>(cacheKey)
    if (cachedResponse) {
        return jsonNoStore(cachedResponse)
    }

    const startDateTime = dateRange ? `${dateRange.startDate} 00:00:00` : null
    const endDateTime = dateRange ? `${dateRange.endDate} 23:59:59` : null
    const proposalFilter = `${isAdmin ? '' : ' AND responsavel_id = ?'}${
      dateRange ? ' AND created_at BETWEEN ? AND ?' : ''
    }`
    const proposalAliasedFilter = `${isAdmin ? '' : ' AND p.responsavel_id = ?'}${
      dateRange ? ' AND p.created_at BETWEEN ? AND ?' : ''
    }`
    const proposalParams = isAdmin
      ? dateRange
        ? [startDateTime, endDateTime]
        : []
      : dateRange
        ? [user.id, startDateTime, endDateTime]
        : [user.id]
    const taskFilter = `${isAdmin ? '' : ' AND t.responsavel_id = ?'}${
      dateRange ? ' AND t.data_hora BETWEEN ? AND ?' : ''
    }`
    const taskParams = isAdmin
      ? dateRange
        ? [startDateTime, endDateTime]
        : []
      : dateRange
        ? [user.id, startDateTime, endDateTime]
        : [user.id]
    const rankingLimit = isAdmin ? 'LIMIT 5' : ''
    const clientAlertQuery = isAdmin
      ? `SELECT DISTINCT ${DASHBOARD_CLIENT_ALERT_SELECT_COLUMNS}
         FROM clientes c
         INNER JOIN propostas p
           ON p.cliente_id = c.id
           ${dateRange ? 'AND p.created_at BETWEEN ? AND ?' : ''}
         WHERE NOT EXISTS (
           SELECT 1
           FROM tarefas t
           LEFT JOIN propostas tp ON tp.id = t.proposta_id
           WHERE COALESCE(t.cliente_id, tp.cliente_id) = c.id
             AND t.status = 'pendente'
             ${dateRange ? 'AND t.data_hora BETWEEN ? AND ?' : ''}
         )
         LIMIT 10`
      : `SELECT DISTINCT ${DASHBOARD_CLIENT_ALERT_SELECT_COLUMNS}
         FROM clientes c
         INNER JOIN propostas p
           ON p.cliente_id = c.id
           AND p.responsavel_id = ?
           ${dateRange ? 'AND p.created_at BETWEEN ? AND ?' : ''}
         WHERE NOT EXISTS (
           SELECT 1
           FROM tarefas t
           LEFT JOIN propostas tp ON tp.id = t.proposta_id
           WHERE COALESCE(t.cliente_id, tp.cliente_id) = c.id
             AND t.status = 'pendente'
             AND t.responsavel_id = ?
             ${dateRange ? 'AND t.data_hora BETWEEN ? AND ?' : ''}
         )
         LIMIT 10`
    const clientAlertParams = isAdmin
      ? dateRange
        ? [startDateTime, endDateTime, startDateTime, endDateTime]
        : []
      : dateRange
        ? [user.id, startDateTime, endDateTime, user.id, startDateTime, endDateTime]
        : [user.id, user.id]

    const [
      [leadsResult],
      [totalPropostas],
      [fechadas],
      [pipelineResult],
      [vendasMesResult],
      funilData,
      vendasPorMes,
      rankingVendedores,
      tarefasPeriodo,
      tarefasAtrasadas,
      clientesSemTarefa,
      propostasEmAberto,
    ] = await Promise.all([
      query<any[]>(
        `SELECT COUNT(*) as total
         FROM propostas
         WHERE status <> 'fechado' AND status <> 'perdido'${proposalFilter}`,
        proposalParams
      ),
      query<any[]>(
        `SELECT COUNT(*) as total FROM propostas WHERE 1=1${proposalFilter}`,
        proposalParams
      ),
      query<any[]>(
        `SELECT COUNT(*) as total FROM propostas WHERE status = 'fechado'${proposalFilter}`,
        proposalParams
      ),
      query<any[]>(
        `SELECT COALESCE(SUM(valor_final), 0) as total
         FROM propostas
         WHERE status <> 'fechado' AND status <> 'perdido'${proposalFilter}`,
        proposalParams
      ),
      query<any[]>(
        `SELECT COALESCE(SUM(valor_final), 0) as total
         FROM propostas
         WHERE status = 'fechado'
            ${dateRange ? 'AND updated_at BETWEEN ? AND ?' : ''}${isAdmin ? '' : ' AND responsavel_id = ?'}`,
         isAdmin
           ? dateRange
             ? [startDateTime, endDateTime]
             : []
           : dateRange
             ? [startDateTime, endDateTime, user.id]
             : [user.id]
      ),
      query<any[]>(
        `SELECT status as status_lead, COUNT(*) as count, COALESCE(SUM(valor_final), 0) as valor
         FROM propostas
         WHERE 1=1${proposalFilter}
         GROUP BY status
         ORDER BY FIELD(status, 'novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao', 'enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido')`,
        proposalParams
      ),
      query<any[]>(
        `SELECT
           DATE_FORMAT(updated_at, '%Y-%m') as mes,
           COALESCE(SUM(valor_final), 0) as valor,
           COUNT(*) as quantidade
         FROM propostas
         WHERE status = 'fechado'
            ${dateRange ? 'AND updated_at BETWEEN ? AND ?' : ''}${isAdmin ? '' : ' AND responsavel_id = ?'}
          GROUP BY DATE_FORMAT(updated_at, '%Y-%m')
          ORDER BY mes ASC`,
         isAdmin
           ? dateRange
             ? [startDateTime, endDateTime]
             : []
           : dateRange
             ? [startDateTime, endDateTime, user.id]
             : [user.id]
      ),
      query<any[]>(
        `SELECT
           u.id,
           u.nome,
           u.avatar,
           COALESCE(u.meta_vendas, 0) as meta_vendas,
           COUNT(p.id) as total_vendas,
           COALESCE(SUM(p.valor_final), 0) as valor_total
         FROM usuarios u
         LEFT JOIN propostas p
           ON u.id = p.responsavel_id
           AND p.status = 'fechado'
           ${dateRange ? 'AND p.updated_at BETWEEN ? AND ?' : ''}
         WHERE u.role IN ('vendedor', 'gerente')
           ${isAdmin ? '' : 'AND u.id = ?'}
         GROUP BY u.id, u.nome, u.avatar, u.meta_vendas
         ORDER BY valor_total DESC
         ${rankingLimit}`,
         isAdmin
           ? dateRange
             ? [startDateTime, endDateTime]
             : []
           : dateRange
             ? [startDateTime, endDateTime, user.id]
             : [user.id]
      ),
      query<any[]>(
        `SELECT
           ${DASHBOARD_TASK_SELECT_COLUMNS}
         FROM tarefas t
         LEFT JOIN propostas p ON t.proposta_id = p.id
         LEFT JOIN clientes c ON COALESCE(t.cliente_id, p.cliente_id) = c.id
         WHERE t.status <> 'concluida'${taskFilter}
         ORDER BY t.data_hora ASC
         LIMIT 10`,
        taskParams
      ),
      query<any[]>(
        `SELECT
           t.id
         FROM tarefas t
         LEFT JOIN propostas p ON t.proposta_id = p.id
         WHERE t.data_hora < NOW()
           AND t.status = 'pendente'${taskFilter}
         ORDER BY t.data_hora ASC`,
        taskParams
      ),
      query<any[]>(clientAlertQuery, clientAlertParams),
      query<any[]>(
        `SELECT ${DASHBOARD_PROPOSAL_ALERT_SELECT_COLUMNS}
         FROM propostas p
         LEFT JOIN clientes c ON p.cliente_id = c.id
         WHERE p.status IN ('novo_cliente', 'em_orcamento', 'aguardando_aprovacao', 'enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias', 'stand_by', 'em_retificacao')${proposalAliasedFilter}
         ORDER BY p.updated_at DESC
         LIMIT 10`,
        proposalParams
      ),
    ])

    const taxaConversao =
      totalPropostas.total > 0 ? ((fechadas.total / totalPropostas.total) * 100).toFixed(1) : '0'

    const payload = {
      stats: {
        totalLeads: leadsResult.total,
        taxaConversao: parseFloat(taxaConversao),
        valorPipeline: pipelineResult.total,
        vendasMes: vendasMesResult.total,
      },
      funilData,
      vendasPorMes,
      rankingVendedores,
      tarefasPeriodo,
      alertas: {
        tarefasAtrasadas,
        clientesSemTarefa,
        propostasEmAberto,
      },
    }

    setRuntimeCache(cacheKey, payload, DASHBOARD_CACHE_TTL_MS)
    return jsonNoStore(payload)
  } catch (error) {
    console.error('Erro ao buscar dados do dashboard:', error)
    const sessionUserId = session?.userId || null
    const sessionRole = session?.role || 'anon'
    const staleCacheKey = sessionUserId
      ? `dashboard:${sessionRole}:${sessionUserId}:${dateRange?.startDate || 'all'}:${dateRange?.endDate || 'all'}`
      : null
    const staleCachedResponse = staleCacheKey ? getRuntimeCache<any>(staleCacheKey) : null

    if (staleCachedResponse) {
      return jsonNoStore({
        ...staleCachedResponse,
        degraded: true,
        stale: true,
      })
    }

    if (session) {
      return jsonNoStore({
        ...defaults,
        degraded: true,
      })
    }

    return jsonNoStore({ error: 'Erro ao buscar dados do dashboard' }, { status: 500 })
  }
}
