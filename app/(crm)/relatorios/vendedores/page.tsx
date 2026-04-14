'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { createDefaultDateFilter, isWithinDateFilter } from '@/lib/utils/date-filter'
import { Pencil } from 'lucide-react'

const chartColors = ['#0f766e', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#059669']

export default function RelatorioVendedoresPage() {
  const { state, updateUsuario } = useCRM()
  const { formatCurrency } = useAppSettings()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const [editingMetaUserId, setEditingMetaUserId] = useState<string | null>(null)
  const [metaInput, setMetaInput] = useState('')

  if (!hasModuleAccess(user, 'performance')) {
    return <ModuleAccessState module="performance" />
  }

  const vendedores = state.usuarios.filter((usuario) => usuario.role === 'vendedor' || usuario.role === 'gerente')
  const orcamentistas = state.usuarios.filter((usuario) => usuario.role === 'orcamentista')
  const propostasFiltradas = useMemo(
    () =>
      state.propostas.filter((proposta) =>
        isWithinDateFilter(proposta.criadoEm ?? proposta.dataEnvio, dateFilter)
      ),
    [dateFilter, state.propostas]
  )

  const performance = vendedores
    .map((vendedor) => {
      const propostas = propostasFiltradas.filter((proposta) => proposta.responsavelId === vendedor.id)
      const fechadas = propostas.filter((proposta) => proposta.status === 'fechado')
      const perdidas = propostas.filter((proposta) => proposta.status === 'perdido')
      const abertas = propostas.length - fechadas.length - perdidas.length
      const clientes = new Set(propostas.map((proposta) => proposta.clienteId))
      const receita = fechadas.reduce((acc, proposta) => acc + proposta.valor, 0)
      const ticketMedio = fechadas.length > 0 ? receita / fechadas.length : 0
      const taxaConversao = propostas.length > 0 ? (fechadas.length / propostas.length) * 100 : 0

      return {
        id: vendedor.id,
        nome: vendedor.nome,
        avatar: vendedor.avatar,
        metaVendas: Number(vendedor.metaVendas || 0),
        clientes: clientes.size,
        propostas: propostas.length,
        abertas,
        fechadas: fechadas.length,
        perdidas: perdidas.length,
        receita,
        ticketMedio,
        taxaConversao,
      }
    })
    .sort((a, b) => b.receita - a.receita)

  const revenueChartData = performance.map((item) => ({
    name: item.nome.split(' ')[0],
    receita: item.receita,
    conversao: Number(item.taxaConversao.toFixed(1)),
  }))

  const proposalMixData = performance.map((item) => ({
    name: item.nome.split(' ')[0],
    value: item.propostas,
  }))

  const budgetPerformance = orcamentistas.map((orcamentista) => {
    const propostas = propostasFiltradas.filter((proposta) => proposta.orcamentistaId === orcamentista.id)
    const recebidas = propostas.length
    const emAndamento = propostas.filter((proposta) =>
      ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
    ).length
    const aprovadasSemRetificacao = propostas.filter(
      (proposta) =>
        ['enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido'].includes(proposta.status) &&
        Number(proposta.retificacoesCount || 0) === 0
    ).length
    const comRetificacao = propostas.filter((proposta) => Number(proposta.retificacoesCount || 0) > 0).length
    const aguardandoAprovacao = propostas.filter((proposta) => proposta.status === 'aguardando_aprovacao').length

    return {
      id: orcamentista.id,
      nome: orcamentista.nome,
      recebidas,
      emAndamento,
      aprovadasSemRetificacao,
      comRetificacao,
      aguardandoAprovacao,
    }
  })

  const budgetChartData = budgetPerformance.map((item) => ({
    name: item.nome.split(' ')[0],
    recebidas: item.recebidas,
    aprovadas: item.aprovadasSemRetificacao,
    retificadas: item.comRetificacao,
  }))

  const handleOpenMetaDialog = (userId: string, currentMeta: number) => {
    setEditingMetaUserId(userId)
    setMetaInput(String(currentMeta || 0))
  }

  const handleSaveMeta = async () => {
    if (!editingMetaUserId) return
    const usuario = state.usuarios.find((item) => item.id === editingMetaUserId)
    if (!usuario) return

    await updateUsuario({
      ...usuario,
      metaVendas: Number(metaInput || 0),
    })

    setEditingMetaUserId(null)
    setMetaInput('')
  }

  return (
    <>
      <CRMHeader
        title="Performance de Vendedores"
        subtitle="Metricas consolidadas de conversao, receita e carteira por vendedor"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <MetricCard title="Vendedores Ativos" value={performance.length} />
          <MetricCard
            title="Receita Total"
            value={formatCurrency(performance.reduce((acc, item) => acc + item.receita, 0))}
          />
          <MetricCard
            title="Propostas Fechadas"
            value={performance.reduce((acc, item) => acc + item.fechadas, 0)}
          />
          <MetricCard
            title="Taxa Media"
            value={`${(
              performance.reduce((acc, item) => acc + item.taxaConversao, 0) /
              Math.max(performance.length, 1)
            ).toFixed(1)}%`}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Receita por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `R$${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value: number) => [formatCurrency(value), 'Receita']} />
                  <Bar dataKey="receita" radius={[8, 8, 0, 0]}>
                    {revenueChartData.map((entry, index) => (
                      <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Volume de Propostas por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={proposalMixData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {proposalMixData.map((entry, index) => (
                      <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} propostas`, 'Volume']} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Performance de Orcamentistas</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={budgetChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="recebidas" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="aprovadas" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="retificadas" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenMetaDialog(item.id, item.metaVendas)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
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
      </div>

      <Dialog open={Boolean(editingMetaUserId)} onOpenChange={(open) => !open && setEditingMetaUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir meta de vendas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Meta</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={metaInput}
                onChange={(event) => setMetaInput(event.target.value)}
                placeholder="0.00"
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
