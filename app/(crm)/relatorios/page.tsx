'use client'

import { useMemo, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts'
import { DollarSign, Users, Target, Percent } from 'lucide-react'
import { statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'
import { createDefaultDateFilter, isWithinDateFilter, type DateFilterValue } from '@/lib/utils/date-filter'

const funnelStatuses: { status: StatusProposta; color: string }[] = [
  { status: 'em_cotacao', color: '#64748b' },
  { status: 'enviado_ao_cliente', color: '#3b82f6' },
  { status: 'em_negociacao', color: '#f59e0b' },
  { status: 'em_retificacao', color: '#a855f7' },
  { status: 'fechado', color: '#10b981' },
  { status: 'perdido', color: '#ef4444' },
]

export default function RelatoriosPage() {
  const { state } = useCRM()
  const { appearance, formatCurrency } = useAppSettings()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())

  if (user && user.role !== 'admin') {
    return (
      <>
        <CRMHeader title="Relatorios" subtitle="Acesso restrito ao administrador" />
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-xl border-border bg-card">
            <CardContent className="p-8 text-center text-muted-foreground">
              Apenas o administrador pode visualizar os relatorios consolidados.
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

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

  const totalClientes = clientesFiltrados.length
  const totalLeads = propostasFiltradas.filter((proposta) =>
    ['em_cotacao', 'enviado_ao_cliente', 'em_negociacao', 'em_retificacao'].includes(proposta.status)
  ).length
  const vendasFechadas = propostasFiltradas.filter((proposta) => proposta.status === 'fechado')
  const totalReceita = vendasFechadas.reduce((acc, proposta) => acc + proposta.valor, 0)
  const taxaConversaoGeral =
    propostasFiltradas.length > 0 ? ((vendasFechadas.length / propostasFiltradas.length) * 100).toFixed(1) : '0'

  const funilData = funnelStatuses.map((stage) => {
    const propostasEtapa = propostasFiltradas.filter((proposta) => proposta.status === stage.status)

    return {
      name: statusPropostaLabels[stage.status],
      count: propostasEtapa.length,
      valor: propostasEtapa.reduce((acc, proposta) => acc + proposta.valor, 0),
      color: stage.color,
    }
  })

  const vendedoresData = state.usuarios
    .filter((usuario) => usuario.role !== 'admin')
    .map((vendedor) => {
      const clientes = new Set(
        propostasFiltradas
          .filter((proposta) => proposta.responsavelId === vendedor.id)
          .map((proposta) => proposta.clienteId)
      )
      const propostasFechadas = propostasFiltradas.filter(
        (proposta) => proposta.status === 'fechado' && proposta.responsavelId === vendedor.id
      )

      return {
        name: vendedor.nome.split(' ')[0],
        clientes: clientes.size,
        vendas: propostasFechadas.length,
        receita: propostasFechadas.reduce((acc, proposta) => acc + proposta.valor, 0),
      }
    })
    .sort((a, b) => b.receita - a.receita)

  const origensData = clientesFiltrados.reduce(
    (acc, cliente) => {
      const existente = acc.find((item) => item.name === cliente.origem)
      if (existente) {
        existente.value += 1
      } else {
        acc.push({ name: cliente.origem, value: 1 })
      }
      return acc
    },
    [] as { name: string; value: number }[]
  )

  const evolucaoData = buildEvolutionData(propostasFiltradas, dateFilter, appearance.idioma)

  const stats = [
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
      description: `${vendasFechadas.length} vendas`,
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
      value: formatCurrency(vendasFechadas.length > 0 ? totalReceita / vendasFechadas.length : 0),
      description: 'Por fechamento',
      icon: Target,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ]

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444']

  return (
    <>
      <CRMHeader title="Relatorios" subtitle="Analise de performance e metricas" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.title} className="bg-card border-border">
              <CardContent className="p-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Funil de Vendas</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={funilData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={140} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {funilData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Origem dos Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={origensData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {origensData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Evolucao Mensal</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={evolucaoData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="mes" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="leads" name="Leads" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="vendas" name="Fechamentos" stroke="#10b981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Performance por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={vendedoresData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="vendas" name="Fechamentos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
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
