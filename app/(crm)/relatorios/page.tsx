'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, Users, Target, Percent } from 'lucide-react'
import { statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'
import { createDefaultDateFilter, isWithinDateFilter, type DateFilterValue } from '@/lib/utils/date-filter'

const GeneralReportCharts = dynamic(
  () => import('@/components/crm/reports/general-report-charts').then((mod) => mod.GeneralReportCharts),
  {
    loading: () => <ReportChartsSkeleton />,
  }
)

const funnelStatuses: { status: StatusProposta; color: string }[] = [
  { status: 'novo_cliente', color: '#0ea5e9' },
  { status: 'em_orcamento', color: '#64748b' },
  { status: 'aguardando_aprovacao', color: '#8b5cf6' },
  { status: 'enviar_ao_cliente', color: '#2563eb' },
  { status: 'enviado_ao_cliente', color: '#3b82f6' },
  { status: 'follow_up_1_dia', color: '#10b981' },
  { status: 'aguardando_follow_up_3_dias', color: '#0f766e' },
  { status: 'follow_up_3_dias', color: '#059669' },
  { status: 'aguardando_follow_up_7_dias', color: '#065f46' },
  { status: 'follow_up_7_dias', color: '#047857' },
  { status: 'stand_by', color: '#71717a' },
  { status: 'em_retificacao', color: '#a855f7' },
  { status: 'fechado', color: '#10b981' },
  { status: 'perdido', color: '#ef4444' },
]

export default function RelatoriosPage() {
  const { state } = useCRM()
  const { appearance, formatCurrency } = useAppSettings()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const hasRelatoriosAccess = hasModuleAccess(user, 'relatorios')

  const clientesFiltrados = useMemo(
    () => state.clientes.filter((cliente) => isWithinDateFilter(cliente.criadoEm, dateFilter)),
    [dateFilter, state.clientes]
  )

  const propostasFiltradas = useMemo(
    () =>
      state.propostas.filter((proposta) =>
        isWithinDateFilter(proposta.criadoEm ?? proposta.dataEnvio, dateFilter)
      ),
    [dateFilter, state.propostas]
  )

  if (!hasRelatoriosAccess) {
    return <ModuleAccessState module="relatorios" />
  }

  const {
    totalClientes,
    totalLeads,
    vendasFechadasCount,
    totalReceita,
    taxaConversaoGeral,
    ticketMedio,
    funilData,
    vendedoresData,
    origensData,
    evolucaoData,
  } = useMemo(() => {
    const leadStatuses = new Set<StatusProposta>([
      'novo_cliente',
      'em_orcamento',
        'aguardando_aprovacao',
        'enviar_ao_cliente',
        'enviado_ao_cliente',
        'follow_up_1_dia',
        'aguardando_follow_up_3_dias',
        'follow_up_3_dias',
        'aguardando_follow_up_7_dias',
        'follow_up_7_dias',
        'stand_by',
        'em_retificacao',
      ])
    const proposalCounts = new Map<StatusProposta, { count: number; valor: number }>()
    const sellerMap = new Map<
      string,
      { name: string; clientes: Set<string>; vendas: number; receita: number }
    >()
    const origemMap = new Map<string, number>()
    let totalLeadsLocal = 0
    let vendasFechadasLocal = 0
    let totalReceitaLocal = 0

    for (const cliente of clientesFiltrados) {
      const origem = cliente.origem || 'Nao informado'
      origemMap.set(origem, (origemMap.get(origem) || 0) + 1)
    }

    for (const usuario of state.usuarios) {
      if (usuario.role === 'vendedor' || usuario.role === 'gerente') {
        sellerMap.set(usuario.id, {
          name: usuario.nome.split(' ')[0],
          clientes: new Set<string>(),
          vendas: 0,
          receita: 0,
        })
      }
    }

    for (const proposta of propostasFiltradas) {
      const current = proposalCounts.get(proposta.status) || { count: 0, valor: 0 }
      current.count += 1
      current.valor += proposta.valor
      proposalCounts.set(proposta.status, current)

      if (leadStatuses.has(proposta.status)) {
        totalLeadsLocal += 1
      }

      const seller = proposta.responsavelId ? sellerMap.get(proposta.responsavelId) : undefined
      if (seller) {
        seller.clientes.add(proposta.clienteId)
        if (proposta.status === 'fechado') {
          seller.vendas += 1
          seller.receita += proposta.valor
        }
      }

      if (proposta.status === 'fechado') {
        vendasFechadasLocal += 1
        totalReceitaLocal += proposta.valor
      }
    }

    return {
      totalClientes: clientesFiltrados.length,
      totalLeads: totalLeadsLocal,
      vendasFechadasCount: vendasFechadasLocal,
      totalReceita: totalReceitaLocal,
      taxaConversaoGeral:
        propostasFiltradas.length > 0
          ? ((vendasFechadasLocal / propostasFiltradas.length) * 100).toFixed(1)
          : '0',
      ticketMedio: vendasFechadasLocal > 0 ? totalReceitaLocal / vendasFechadasLocal : 0,
      funilData: funnelStatuses.map((stage) => {
        const data = proposalCounts.get(stage.status) || { count: 0, valor: 0 }
        return {
          name: statusPropostaLabels[stage.status],
          count: data.count,
          valor: data.valor,
          color: stage.color,
        }
      }),
      vendedoresData: Array.from(sellerMap.values())
        .map((seller) => ({
          name: seller.name,
          clientes: seller.clientes.size,
          vendas: seller.vendas,
          receita: seller.receita,
        }))
        .sort((a, b) => b.receita - a.receita),
      origensData: Array.from(origemMap.entries()).map(([name, value]) => ({ name, value })),
      evolucaoData: buildEvolutionData(propostasFiltradas, dateFilter, appearance.idioma),
    }
  }, [appearance.idioma, clientesFiltrados, dateFilter, propostasFiltradas, state.usuarios])

  const stats = useMemo(
    () => [
      {
        title: 'Clientes',
        value: totalClientes,
        description: `${totalLeads} leads em proposta`,
        icon: Users,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
      },
      {
        title: 'Receita Total',
        value: formatCurrency(totalReceita),
        description: `${vendasFechadasCount} vendas`,
        icon: DollarSign,
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10',
      },
      {
        title: 'Taxa de Conversao',
        value: `${taxaConversaoGeral}%`,
        description: 'Propostas -> Fechamentos',
        icon: Percent,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
      },
      {
        title: 'Ticket Medio',
        value: formatCurrency(ticketMedio),
        description: 'Por fechamento',
        icon: Target,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10',
      },
    ],
    [formatCurrency, taxaConversaoGeral, ticketMedio, totalClientes, totalLeads, totalReceita, vendasFechadasCount]
  )

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444']

  return (
    <>
      <CRMHeader title="Relatorios" subtitle="Analise de performance e metricas" />

      <div className="flex-1 overflow-auto space-y-4 p-4 sm:space-y-6 sm:p-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.title} className="bg-card border-border">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.description}</p>
                  </div>
                  <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <GeneralReportCharts
          funilData={funilData}
          origensData={origensData}
          evolucaoData={evolucaoData}
          vendedoresData={vendedoresData}
          colors={colors}
        />
      </div>
    </>
  )
}

function buildEvolutionData(propostas: Proposta[], filter: DateFilterValue, locale: string) {
  const start = new Date(`${filter.startDate}T00:00:00`)
  const end = new Date(`${filter.endDate}T00:00:00`)
  const buckets: {
    mes: string
    leads: number
    vendas: number
    receita: number
    year: number
    month: number
  }[] = []

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)

  while (cursor <= last) {
    buckets.push({
      mes: cursor.toLocaleDateString(locale, { month: 'short' }),
      leads: 0,
      vendas: 0,
      receita: 0,
      year: cursor.getFullYear(),
      month: cursor.getMonth(),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  propostas.forEach((proposta) => {
    const baseDate = new Date(proposta.criadoEm ?? proposta.dataEnvio)
    const bucket = buckets.find(
      (item) => item.month === baseDate.getMonth() && item.year === baseDate.getFullYear()
    )

    if (!bucket) return

    bucket.leads += 1

    if (proposta.status === 'fechado') {
      bucket.vendas += 1
      bucket.receita += proposta.valor
    }
  })

  return buckets.map(({ year, month, ...item }) => item)
}

function ReportChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="bg-card border-border">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
