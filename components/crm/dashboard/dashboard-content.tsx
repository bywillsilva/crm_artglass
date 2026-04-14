'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { updateTarefaStatus, useDashboard, useSession } from '@/lib/hooks/use-api'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { statusPropostaLabels, type StatusProposta } from '@/lib/data/types'
import { createDefaultDateFilter } from '@/lib/utils/date-filter'

const funnelStatuses: StatusProposta[] = [
  'em_cotacao',
  'enviado_ao_cliente',
  'em_negociacao',
  'em_retificacao',
  'fechado',
  'perdido',
]

const statusColors: Record<StatusProposta, string> = {
  em_cotacao: '#64748b',
  enviado_ao_cliente: '#3b82f6',
  em_negociacao: '#f59e0b',
  em_retificacao: '#a855f7',
  fechado: '#10b981',
  perdido: '#ef4444',
}

export function DashboardContent() {
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const { data, isLoading, error } = useDashboard(dateFilter)
  const { appearance, formatCurrency, formatTime } = useAppSettings()
  const { user } = useSession()

  const handleTarefaComplete = async (id: string) => {
    try {
      await updateTarefaStatus(id, 'concluida')
    } catch (err) {
      console.error('Erro ao concluir tarefa:', err)
    }
  }

  if (isLoading) {
    return (
      <>
        <CRMHeader title="Dashboard" subtitle="Visao geral do seu negocio" />
        <div className="flex-1 overflow-auto p-6 space-y-6">
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <DashboardSkeleton />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <CRMHeader title="Dashboard" subtitle="Visao geral do seu negocio" />
        <div className="flex-1 overflow-auto p-6">
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <Card className="bg-card border-border">
            <CardContent className="p-6 text-center">
              <p className="mb-4 text-destructive">Erro ao carregar dados do dashboard</p>
              <p className="mb-4 text-sm text-muted-foreground">{error.message}</p>
              <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  const { stats, funilData, vendasPorMes, rankingVendedores, tarefasPeriodo, alertas } = data || {}

  const funnelChartData = funnelStatuses.map((status) => {
    const item = funilData?.find((entry: any) => entry.status_lead === status)
    return {
      name: statusPropostaLabels[status],
      value: item?.count || 0,
      valor: Number(item?.valor || 0),
      color: statusColors[status],
    }
  })

  const salesChartData = (vendasPorMes || []).map((item: any) => ({
    name: new Date(`${item.mes}-01`).toLocaleDateString(appearance.idioma, {
      month: 'short',
    }),
    valor: Number(item.valor),
    quantidade: item.quantidade,
  }))
  const vendedorAtual = user?.role === 'admin' ? null : rankingVendedores?.[0]
  const metaAtual = Number(vendedorAtual?.meta_vendas || 0)
  const valorAtual = Number(vendedorAtual?.valor_total || 0)
  const progressoMeta = metaAtual > 0 ? Math.min((valorAtual / metaAtual) * 100, 100) : 0

  return (
    <>
      <CRMHeader title="Dashboard" subtitle="Visao geral do seu negocio" />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Leads em Proposta" value={stats?.totalLeads || 0} icon={Users} color="text-blue-400" bgColor="bg-blue-500/10" />
          <StatsCard title="Taxa de Conversao" value={`${stats?.taxaConversao || 0}%`} icon={TrendingUp} color="text-emerald-400" bgColor="bg-emerald-500/10" />
          <StatsCard title="Valor no Pipeline" value={formatCurrency(stats?.valorPipeline || 0)} icon={Target} color="text-purple-400" bgColor="bg-purple-500/10" />
          <StatsCard title="Vendas Fechadas no Periodo" value={formatCurrency(stats?.vendasMes || 0)} icon={DollarSign} color="text-amber-400" bgColor="bg-amber-500/10" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-lg">Funil de Propostas</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={funnelChartData} layout="vertical">
                  <XAxis type="number" stroke="#666" />
                  <YAxis type="category" dataKey="name" stroke="#666" width={140} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                    formatter={(value: number) => [`${value} propostas`, 'Quantidade']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-lg">Fechamentos Mensais</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={salesChartData}>
                  <XAxis dataKey="name" stroke="#666" />
                  <YAxis stroke="#666" tickFormatter={(value) => `R$${value / 1000}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                    formatter={(value: number) => [formatCurrency(value), 'Valor']}
                  />
                  <Area type="monotone" dataKey="valor" stroke="#10b981" fill="#10b98133" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-lg">
                {user?.role === 'admin' ? 'Ranking de Vendedores' : 'Minhas Vendas'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role !== 'admin' && vendedorAtual ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {vendedorAtual.avatar || vendedorAtual.nome?.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Total fechado no periodo</p>
                      <p className="text-2xl font-bold text-foreground">{formatCurrency(valorAtual)}</p>
                    </div>
                  </div>
                  {metaAtual > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Meta {formatCurrency(metaAtual)}</span>
                        <span>{progressoMeta.toFixed(0)}%</span>
                      </div>
                      <Progress value={progressoMeta} className="h-2.5" />
                      <p className="text-sm text-muted-foreground">
                        {valorAtual >= metaAtual
                          ? 'Meta atingida neste periodo.'
                          : `Faltam ${formatCurrency(metaAtual - valorAtual)} para atingir a meta.`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma meta definida para este vendedor ainda.
                    </p>
                  )}
                </div>
              ) : (
                (rankingVendedores || []).slice(0, 5).map((vendedor: any, index: number) => {
                  const maxValor = Math.max(...(rankingVendedores || []).map((entry: any) => Number(entry.valor_total) || 1))
                  const percent = (Number(vendedor.valor_total) / maxValor) * 100

                  return (
                  <div key={vendedor.id} className="flex items-center gap-4">
                    <span className={`w-6 text-lg font-bold ${index === 0 ? 'text-amber-400' : index === 1 ? 'text-slate-400' : index === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      {index + 1}
                    </span>
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {vendedor.avatar || vendedor.nome?.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{vendedor.nome}</span>
                        <span className="text-sm text-muted-foreground">{formatCurrency(Number(vendedor.valor_total))}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  </div>
                  )
                })
              )}
              {(!rankingVendedores || rankingVendedores.length === 0) && (
                <p className="py-4 text-center text-muted-foreground">Nenhum fechamento registrado</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-foreground text-lg">Tarefas do Periodo</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href="/tarefas">Ver todas</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(tarefasPeriodo || []).slice(0, 5).map((tarefa: any) => (
                  <div key={tarefa.id} className="flex items-start gap-3 rounded-lg bg-secondary/50 p-3">
                    <Checkbox
                      className="mt-0.5 border-slate-500 data-[state=checked]:border-slate-700 data-[state=checked]:bg-slate-700"
                      onCheckedChange={() => handleTarefaComplete(tarefa.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{tarefa.titulo}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(tarefa.data_hora)}
                        <span>•</span>
                        <Link href={`/clientes/${tarefa.cliente_id}`} className="hover:text-primary">
                          {tarefa.cliente_nome}
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
                {(!tarefasPeriodo || tarefasPeriodo.length === 0) && (
                  <p className="py-4 text-center text-muted-foreground">Nenhuma tarefa encontrada no periodo</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-lg">Alertas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AlertCard icon={<Clock className="h-4 w-4 text-red-400" />} title="Tarefas Atrasadas" count={alertas?.tarefasAtrasadas?.length || 0} color="bg-red-500/10" />
              <AlertCard icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} title="Clientes sem Tarefa" count={alertas?.clientesSemTarefa?.length || 0} color="bg-amber-500/10" />
              <AlertCard icon={<FileText className="h-4 w-4 text-blue-400" />} title="Propostas em Andamento" count={alertas?.propostasEmAberto?.length || 0} color="bg-blue-500/10" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  bgColor,
}: {
  title: string
  value: string | number
  icon: any
  color: string
  bgColor: string
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
          </div>
          <div className={`rounded-lg p-3 ${bgColor}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AlertCard({
  icon,
  title,
  count,
  color,
}: {
  icon: React.ReactNode
  title: string
  count: number
  color: string
}) {
  return (
    <div className={`rounded-lg border border-border p-4 ${color}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-background/40 p-2">{icon}</div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{count} item(ns)</p>
        </div>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Card key={item} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-7 w-28" />
                </div>
                <Skeleton className="h-11 w-11 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[1, 2].map((item) => (
          <Card key={item} className="bg-card border-border">
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
