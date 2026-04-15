import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { ensureCrmRuntimeSchema, syncDueFollowUpStatuses } from '@/lib/server/proposal-workflow'

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

function getDefaultDateRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const pad = (value: number) => String(value).padStart(2, '0')
  const toDateOnly = (value: Date) =>
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  }
}

function getDateRange(request: NextRequest) {
  const defaults = getDefaultDateRange()
  const startDate = request.nextUrl.searchParams.get('startDate') || defaults.startDate
  const endDate = request.nextUrl.searchParams.get('endDate') || defaults.endDate

  if (startDate <= endDate) {
    return { startDate, endDate }
  }

  return { startDate: endDate, endDate: startDate }
}

export async function GET(request: NextRequest) {
  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    await syncDueFollowUpStatuses()

    const isAdmin = user.role === 'admin' || user.role === 'gerente'
    const { startDate, endDate } = getDateRange(request)
    const startDateTime = `${startDate} 00:00:00`
    const endDateTime = `${endDate} 23:59:59`
    const proposalFilter = `${isAdmin ? '' : ' AND responsavel_id = ?'} AND created_at BETWEEN ? AND ?`
    const proposalAliasedFilter = `${isAdmin ? '' : ' AND p.responsavel_id = ?'} AND p.created_at BETWEEN ? AND ?`
    const proposalParams = isAdmin ? [startDateTime, endDateTime] : [user.id, startDateTime, endDateTime]
    const taskFilter = `${isAdmin ? '' : ' AND t.responsavel_id = ?'} AND t.data_hora BETWEEN ? AND ?`
    const taskParams = isAdmin ? [startDateTime, endDateTime] : [user.id, startDateTime, endDateTime]
    const rankingLimit = isAdmin ? 'LIMIT 5' : ''

    const [leadsResult] = await query<any[]>(
      `SELECT COUNT(*) as total
       FROM propostas
       WHERE status <> 'fechado' AND status <> 'perdido'${proposalFilter}`,
      proposalParams
    )

    const [totalPropostas] = await query<any[]>(
      `SELECT COUNT(*) as total FROM propostas WHERE 1=1${proposalFilter}`,
      proposalParams
    )

    const [fechadas] = await query<any[]>(
      `SELECT COUNT(*) as total FROM propostas WHERE status = 'fechado'${proposalFilter}`,
      proposalParams
    )

    const taxaConversao =
      totalPropostas.total > 0 ? ((fechadas.total / totalPropostas.total) * 100).toFixed(1) : '0'

    const [pipelineResult] = await query<any[]>(
      `SELECT COALESCE(SUM(valor_final), 0) as total
       FROM propostas
       WHERE status <> 'fechado' AND status <> 'perdido'${proposalFilter}`,
      proposalParams
    )

    const [vendasMesResult] = await query<any[]>(
       `SELECT COALESCE(SUM(valor_final), 0) as total
       FROM propostas
       WHERE status = 'fechado'
         AND updated_at BETWEEN ? AND ?${isAdmin ? '' : ' AND responsavel_id = ?'}`,
      isAdmin ? [startDateTime, endDateTime] : [startDateTime, endDateTime, user.id]
    )

    const funilData = await query<any[]>(
       `SELECT status as status_lead, COUNT(*) as count, COALESCE(SUM(valor_final), 0) as valor
        FROM propostas
        WHERE 1=1${proposalFilter}
        GROUP BY status
        ORDER BY FIELD(status, 'novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao', 'enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido')`,
       proposalParams
     )

    const vendasPorMes = await query<any[]>(
      `SELECT
         DATE_FORMAT(updated_at, '%Y-%m') as mes,
         COALESCE(SUM(valor_final), 0) as valor,
         COUNT(*) as quantidade
       FROM propostas
       WHERE status = 'fechado'
         AND updated_at BETWEEN ? AND ?${isAdmin ? '' : ' AND responsavel_id = ?'}
       GROUP BY DATE_FORMAT(updated_at, '%Y-%m')
       ORDER BY mes ASC`,
      isAdmin ? [startDateTime, endDateTime] : [startDateTime, endDateTime, user.id]
    )

    const rankingVendedores = await query<any[]>(
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
        AND p.updated_at BETWEEN ? AND ?
       WHERE u.role IN ('vendedor', 'gerente')
         ${isAdmin ? '' : 'AND u.id = ?'}
       GROUP BY u.id, u.nome, u.avatar, u.meta_vendas
       ORDER BY valor_total DESC
       ${rankingLimit}`,
      isAdmin ? [startDateTime, endDateTime] : [startDateTime, endDateTime, user.id]
    )

    const tarefasPeriodo = await query<any[]>(
      `SELECT t.*, c.nome as cliente_nome, u.nome as responsavel_nome
       FROM tarefas t
       LEFT JOIN clientes c ON t.cliente_id = c.id
       LEFT JOIN usuarios u ON t.responsavel_id = u.id
       WHERE t.status <> 'concluida'${taskFilter}
       ORDER BY t.data_hora ASC
       LIMIT 10`,
      taskParams
    )

    const tarefasAtrasadas = await query<any[]>(
       `SELECT t.*, c.nome as cliente_nome
       FROM tarefas t
       LEFT JOIN clientes c ON t.cliente_id = c.id
       WHERE t.data_hora < NOW()
         AND t.status = 'pendente'${taskFilter}
       ORDER BY t.data_hora ASC`,
      taskParams
    )

    const clientesSemTarefa = await query<any[]>(
      isAdmin
        ? `SELECT DISTINCT c.*
           FROM clientes c
           INNER JOIN propostas p
             ON p.cliente_id = c.id
            AND p.created_at BETWEEN ? AND ?
           LEFT JOIN tarefas t
             ON c.id = t.cliente_id
            AND t.status = 'pendente'
            AND t.data_hora BETWEEN ? AND ?
           WHERE t.id IS NULL
           LIMIT 10`
        : `SELECT DISTINCT c.*
           FROM clientes c
           INNER JOIN propostas p
             ON p.cliente_id = c.id
            AND p.responsavel_id = ?
            AND p.created_at BETWEEN ? AND ?
           LEFT JOIN tarefas t
             ON c.id = t.cliente_id
            AND t.status = 'pendente'
            AND t.responsavel_id = ?
            AND t.data_hora BETWEEN ? AND ?
           WHERE t.id IS NULL
           LIMIT 10`,
      isAdmin
        ? [startDateTime, endDateTime, startDateTime, endDateTime]
        : [user.id, startDateTime, endDateTime, user.id, startDateTime, endDateTime]
    )

    const propostasEmAberto = await query<any[]>(
       `SELECT p.*, c.nome as cliente_nome
        FROM propostas p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        WHERE p.status IN ('novo_cliente', 'em_orcamento', 'aguardando_aprovacao', 'enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'em_retificacao')${proposalAliasedFilter}
        ORDER BY p.updated_at DESC
        LIMIT 10`,
      proposalParams
    )

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Erro ao buscar dados do dashboard:', error)
    return NextResponse.json({ error: 'Erro ao buscar dados do dashboard' }, { status: 500 })
  }
}
