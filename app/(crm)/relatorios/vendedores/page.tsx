'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { createDefaultDateFilter, isWithinDateFilter } from '@/lib/utils/date-filter'
import { Pencil } from 'lucide-react'

const VendorPerformanceCharts = dynamic(
  () =>
    import('@/components/crm/reports/vendor-performance-charts').then(
      (mod) => mod.VendorPerformanceCharts
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card className="border-border bg-card">
            <CardContent className="h-[388px] animate-pulse" />
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="h-[388px] animate-pulse" />
          </Card>
        </div>
        <Card className="border-border bg-card">
          <CardContent className="h-[388px] animate-pulse" />
        </Card>
      </div>
    ),
  }
)

function parseBrazilianDecimal(value: string) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return 0

  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function RelatorioVendedoresPage() {
  const { state, updateUsuario } = useCRM()
  const { formatCurrency } = useAppSettings()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const [editingMetaUserId, setEditingMetaUserId] = useState<string | null>(null)
  const [metaInput, setMetaInput] = useState('')
  const hasPerformanceAccess = hasModuleAccess(user, 'performance')
  const canManageSellerGoals = user?.role === 'admin' || user?.role === 'gerente'

  const vendedores = useMemo(
    () => state.usuarios.filter((usuario) => usuario.role === 'vendedor' || usuario.role === 'gerente'),
    [state.usuarios]
  )
  const orcamentistas = useMemo(
    () => state.usuarios.filter((usuario) => usuario.role === 'orcamentista'),
    [state.usuarios]
  )
  const propostasFiltradas = useMemo(
    () =>
      state.propostas.filter((proposta) =>
        isWithinDateFilter(proposta.criadoEm ?? proposta.dataEnvio, dateFilter)
      ),
    [dateFilter, state.propostas]
  )

  if (!hasPerformanceAccess) {
    return <ModuleAccessState module="performance" />
  }

  const {
    performance,
    revenueChartData,
    proposalMixData,
    budgetPerformance,
    budgetChartData,
    totalReceita,
    totalFechadas,
    mediaConversao,
    totalRecebidasOrcamento,
    totalSemRetificacao,
    mediaSemRetificacao,
  } = useMemo(() => {
    const propostasPorResponsavel = new Map<string, typeof propostasFiltradas>()
    const propostasPorOrcamentista = new Map<string, typeof propostasFiltradas>()

    for (const proposta of propostasFiltradas) {
      const responsavelKey = proposta.responsavelId || ''
      const orcamentistaKey = proposta.orcamentistaId || ''
      const byResponsavel = propostasPorResponsavel.get(responsavelKey) || []
      byResponsavel.push(proposta)
      propostasPorResponsavel.set(responsavelKey, byResponsavel)

      const byOrcamentista = propostasPorOrcamentista.get(orcamentistaKey) || []
      byOrcamentista.push(proposta)
      propostasPorOrcamentista.set(orcamentistaKey, byOrcamentista)
    }

    const performanceData = vendedores
      .map((vendedor) => {
        const propostas = propostasPorResponsavel.get(vendedor.id) || []
        let fechadas = 0
        let perdidas = 0
        let receita = 0
        const clientes = new Set<string>()

        for (const proposta of propostas) {
          clientes.add(proposta.clienteId)
          if (proposta.status === 'fechado') {
            fechadas += 1
            receita += proposta.valor
          } else if (proposta.status === 'perdido') {
            perdidas += 1
          }
        }

        const abertas = propostas.length - fechadas - perdidas
        const ticketMedio = fechadas > 0 ? receita / fechadas : 0
        const taxaConversao = propostas.length > 0 ? (fechadas / propostas.length) * 100 : 0

        return {
          id: vendedor.id,
          nome: vendedor.nome,
          avatar: vendedor.avatar,
          metaVendas: Number(vendedor.metaVendas || 0),
          clientes: clientes.size,
          propostas: propostas.length,
          abertas,
          fechadas,
          perdidas,
          receita,
          ticketMedio,
          taxaConversao,
        }
      })
      .sort((a, b) => b.receita - a.receita)

    const budgetData = orcamentistas.map((orcamentista) => {
      const propostas = propostasPorOrcamentista.get(orcamentista.id) || []
      let emAndamento = 0
      let aprovadasSemRetificacao = 0
      let comRetificacao = 0
      let aguardandoAprovacao = 0

      for (const proposta of propostas) {
        if (['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)) {
          emAndamento += 1
        }
        if (
          [
            'enviar_ao_cliente',
            'enviado_ao_cliente',
            'follow_up_1_dia',
            'aguardando_follow_up_3_dias',
            'follow_up_3_dias',
            'aguardando_follow_up_7_dias',
            'follow_up_7_dias',
            'stand_by',
            'fechado',
            'perdido',
          ].includes(proposta.status) &&
          Number(proposta.retificacoesCount || 0) === 0
        ) {
          aprovadasSemRetificacao += 1
        }
        if (Number(proposta.retificacoesCount || 0) > 0) {
          comRetificacao += 1
        }
        if (proposta.status === 'aguardando_aprovacao') {
          aguardandoAprovacao += 1
        }
      }

      return {
        id: orcamentista.id,
        nome: orcamentista.nome,
        recebidas: propostas.length,
        emAndamento,
        aprovadasSemRetificacao,
        comRetificacao,
        aguardandoAprovacao,
      }
    })

    return {
      performance: performanceData,
      revenueChartData: performanceData.map((item) => ({
        name: item.nome.split(' ')[0],
        receita: item.receita,
        conversao: Number(item.taxaConversao.toFixed(1)),
      })),
      proposalMixData: performanceData.map((item) => ({
        name: item.nome.split(' ')[0],
        value: item.propostas,
      })),
      budgetPerformance: budgetData,
      budgetChartData: budgetData.map((item) => ({
        name: item.nome.split(' ')[0],
        recebidas: item.recebidas,
        aprovadas: item.aprovadasSemRetificacao,
        retificadas: item.comRetificacao,
      })),
      totalReceita: performanceData.reduce((acc, item) => acc + item.receita, 0),
      totalFechadas: performanceData.reduce((acc, item) => acc + item.fechadas, 0),
      mediaConversao:
        performanceData.reduce((acc, item) => acc + item.taxaConversao, 0) /
        Math.max(performanceData.length, 1),
      totalRecebidasOrcamento: budgetData.reduce((acc, item) => acc + item.recebidas, 0),
      totalSemRetificacao: budgetData.reduce((acc, item) => acc + item.aprovadasSemRetificacao, 0),
      mediaSemRetificacao:
        budgetData.reduce((acc, item) => {
          const taxa = item.recebidas > 0 ? (item.aprovadasSemRetificacao / item.recebidas) * 100 : 0
          return acc + taxa
        }, 0) / Math.max(budgetData.length, 1),
    }
  }, [orcamentistas, propostasFiltradas, vendedores])

  const handleOpenMetaDialog = (userId: string, currentMeta: number) => {
    if (!canManageSellerGoals) return
    setEditingMetaUserId(userId)
    setMetaInput(String(currentMeta || 0))
  }

  const handleSaveMeta = async () => {
    if (!canManageSellerGoals || !editingMetaUserId) return
    const usuario = state.usuarios.find((item) => item.id === editingMetaUserId)
    if (!usuario) return

    const parsedMeta = Math.max(parseBrazilianDecimal(metaInput), 0)

    await updateUsuario({
      ...usuario,
      metaVendas: parsedMeta,
    })

    setEditingMetaUserId(null)
    setMetaInput('')
  }

  return (
    <>
      <CRMHeader
        title="Performance"
        subtitle="Acompanhe vendedores e orcamentistas em sessoes separadas"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <Tabs defaultValue="vendedores" className="space-y-6">
          <TabsList className="grid w-full max-w-[420px] grid-cols-2">
            <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
            <TabsTrigger value="orcamentistas">Orcamentistas</TabsTrigger>
          </TabsList>

          <TabsContent value="vendedores" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <MetricCard title="Vendedores Ativos" value={performance.length} />
              <MetricCard title="Receita Total" value={formatCurrency(totalReceita)} />
              <MetricCard title="Propostas Fechadas" value={totalFechadas} />
              <MetricCard title="Taxa Media" value={`${mediaConversao.toFixed(1)}%`} />
            </div>

            <VendorPerformanceCharts
              formatCurrency={formatCurrency}
              revenueChartData={revenueChartData}
              proposalMixData={proposalMixData}
              budgetChartData={budgetChartData}
              mode="vendedores"
            />

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle>Resumo por Vendedor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {performance.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">Nenhum vendedor encontrado.</p>
                ) : (
                  performance.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-lg font-semibold text-foreground">{item.nome}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.clientes} clientes com propostas | {item.propostas} propostas totais
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-foreground">{formatCurrency(item.receita)}</p>
                          <p className="text-sm text-muted-foreground">
                            Ticket medio {formatCurrency(item.ticketMedio)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                        <MiniMetric label="Conversao" value={`${item.taxaConversao.toFixed(1)}%`} />
                        <MiniMetric label="Abertas" value={item.abertas} />
                        <MiniMetric label="Fechadas" value={item.fechadas} />
                        <MiniMetric label="Perdidas" value={item.perdidas} />
                        <MiniMetric label="Receita" value={formatCurrency(item.receita)} />
                      </div>

                      <div className="mt-4 space-y-2 rounded-lg border border-border bg-background/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Meta de vendas</p>
                            <p className="text-xs text-muted-foreground">
                              {item.metaVendas > 0
                                ? `${formatCurrency(item.receita)} de ${formatCurrency(item.metaVendas)}`
                                : 'Meta ainda nao definida'}
                            </p>
                          </div>
                          {canManageSellerGoals && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleOpenMetaDialog(item.id, item.metaVendas)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <Progress
                          value={item.metaVendas > 0 ? Math.min((item.receita / item.metaVendas) * 100, 100) : 0}
                          className="h-2.5"
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orcamentistas" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <MetricCard title="Orcamentistas Ativos" value={budgetPerformance.length} />
              <MetricCard title="Propostas Recebidas" value={totalRecebidasOrcamento} />
              <MetricCard title="Sem Retificacao" value={totalSemRetificacao} />
              <MetricCard title="Taxa Media Direta" value={`${mediaSemRetificacao.toFixed(1)}%`} />
            </div>

            <VendorPerformanceCharts
              formatCurrency={formatCurrency}
              revenueChartData={revenueChartData}
              proposalMixData={proposalMixData}
              budgetChartData={budgetChartData}
              mode="orcamentistas"
            />

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle>Resumo por Orcamentista</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {budgetPerformance.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">Nenhum orcamentista encontrado.</p>
                ) : (
                  budgetPerformance.map((item) => {
                    const taxaSemRetificacao =
                      item.recebidas > 0 ? (item.aprovadasSemRetificacao / item.recebidas) * 100 : 0

                    return (
                      <div key={item.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-lg font-semibold text-foreground">{item.nome}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.recebidas} propostas recebidas no periodo
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold text-foreground">{item.aprovadasSemRetificacao}</p>
                            <p className="text-sm text-muted-foreground">
                              aprovadas sem retificacao
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                          <MiniMetric label="Recebidas" value={item.recebidas} />
                          <MiniMetric label="Em andamento" value={item.emAndamento} />
                          <MiniMetric label="Sem retificacao" value={item.aprovadasSemRetificacao} />
                          <MiniMetric label="Com retificacao" value={item.comRetificacao} />
                          <MiniMetric label="Aguardando aprovacao" value={item.aguardandoAprovacao} />
                        </div>

                        <div className="mt-4 space-y-2 rounded-lg border border-border bg-background/40 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">Taxa sem retificacao</p>
                              <p className="text-xs text-muted-foreground">
                                {item.aprovadasSemRetificacao} de {item.recebidas} propostas aprovadas direto
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-foreground">{taxaSemRetificacao.toFixed(1)}%</p>
                          </div>
                          <Progress value={taxaSemRetificacao} className="h-2.5" />
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={canManageSellerGoals && Boolean(editingMetaUserId)}
        onOpenChange={(open) => !open && setEditingMetaUserId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir meta de vendas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Meta</label>
              <Input
                type="text"
                inputMode="decimal"
                value={metaInput}
                onChange={(event) => setMetaInput(event.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setEditingMetaUserId(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void handleSaveMeta()}>
                Salvar meta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  )
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}
