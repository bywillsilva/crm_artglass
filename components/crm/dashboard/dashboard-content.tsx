'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  type LucideIcon,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'
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

const DashboardCharts = dynamic(
  () => import('@/components/crm/dashboard/dashboard-charts').then((mod) => mod.DashboardCharts),
  {
    loading: () => <DashboardChartsSkeleton />,
  }
)

const funnelStatuses: StatusProposta[] = [
  'novo_cliente',
  'em_orcamento',
  'aguardando_aprovacao',
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'follow_up_3_dias',
  'follow_up_7_dias',
  'stand_by',
  'em_retificacao',
  'fechado',
  'perdido',
]

const statusColors: Record<StatusProposta, string> = {
  novo_cliente: '#0ea5e9',
  em_orcamento: '#64748b',
  aguardando_aprovacao: '#8b5cf6',
  enviar_ao_cliente: '#2563eb',
  enviado_ao_cliente: '#3b82f6',
  follow_up_1_dia: '#10b981',
  follow_up_3_dias: '#059669',
  follow_up_7_dias: '#047857',
  stand_by: '#71717a',
  em_retificacao: '#a855f7',
  fechado: '#10b981',
  perdido: '#ef4444',
  aguardando_follow_up_3_dias: '#f59e0b',
  aguardando_follow_up_7_dias: '#f59e0b',
}

export function DashboardContent() {
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const { data, isLoading, error } = useDashboard(dateFilter)
  const { appearance, formatCurrency, formatTime } = useAppSettings()
  const { user } = useSession()
  const { stats, funilData, vendasPorMes, rankingVendedores, tarefasPeriodo, alertas } = data || {}

  const funnelChartData = useMemo(
    () =>
      funnelStatuses.map((status) => {
        const item = funilData?.find((entry: any) => entry.status_lead === status)
        return {
          name: statusPropostaLabels[status],
          value: item?.count || 0,
          valor: Number(item?.valor || 0),
          color: statusColors[status],
        }
      }),
    [funilData]
  )

  const salesChartData = useMemo(
    () =>
      (vendasPorMes || []).map((item: any) => ({
        name: new Date(`${item.mes}-01`).toLocaleDateString(appearance.idioma, {
          month: 'short',
        }),
        valor: Number(item.valor),
        quantidade: item.quantidade,
      })),
    [appearance.idioma, vendasPorMes]
  )
  const visibleRanking = useMemo(() => (rankingVendedores || []).slice(0, 5), [rankingVendedores])
  const visibleTasks = useMemo(() => (tarefasPeriodo || []).slice(0, 5), [tarefasPeriodo])
  const vendedorAtual = user?.role === 'admin' || user?.role === 'gerente' ? null : rankingVendedores?.[0]
  const metaAtual = Number(vendedorAtual?.meta_vendas || 0)
  const valorAtual = Number(vendedorAtual?.valor_total || 0)
  const progressoMeta = metaAtual > 0 ? Math.min((valorAtual / metaAtual) * 100, 100) : 0
  const maxRankingValue = useMemo(
    () => Math.max(...(rankingVendedores || []).map((entry: any) => Number(entry.valor_total) || 1), 1),
    [rankingVendedores]
  )

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

        <DashboardCharts
          funnelChartData={funnelChartData}
          salesChartData={salesChartData}
          formatCurrency={formatCurrency}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground text-lg">
                {user?.role === 'admin' || user?.role === 'gerente' ? 'Ranking de Vendedores' : 'Minhas Vendas'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {user?.role !== 'admin' && user?.role !== 'gerente' && vendedorAtual ? (
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
                visibleRanking.map((vendedor: any, index: number) => {
                  const percent = (Number(vendedor.valor_total) / maxRankingValue) * 100

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
                {visibleTasks.map((tarefa: any) => (
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
  icon: LucideIcon
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

function DashboardChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
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
