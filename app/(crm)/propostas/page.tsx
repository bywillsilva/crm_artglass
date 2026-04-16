'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { CRMHeader } from '@/components/crm/header'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Eye, MoreHorizontal, Pencil, X, Clock, DollarSign, TrendingUp } from 'lucide-react'
import { statusPropostaColors, statusPropostaLabels, type StatusProposta } from '@/lib/data/types'

const ProposalFormDialog = dynamic(
  () => import('@/components/crm/propostas/proposal-form-dialog').then((mod) => mod.ProposalFormDialog),
  {
    ssr: false,
  }
)

const ProposalDetailsSheet = dynamic(
  () => import('@/components/crm/propostas/proposal-details-sheet').then((mod) => mod.ProposalDetailsSheet),
  {
    ssr: false,
  }
)

const openStatuses: StatusProposta[] = [
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
]

const tabs: { key: string; label: string; statuses?: StatusProposta[] }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'abertas', label: 'Em andamento', statuses: openStatuses },
  { key: 'fechadas', label: 'Fechadas', statuses: ['fechado'] },
  { key: 'perdidas', label: 'Perdidas', statuses: ['perdido'] },
]

export default function PropostasPage() {
  const { state, getCliente, deleteProposta } = useCRM()
  const { formatCurrency, formatDate } = useAppSettings()
  const { user } = useSession()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)
  const hasPropostasAccess = hasModuleAccess(user, 'propostas')

  const propostasOrdenadas = useMemo(
    () =>
      state.propostas
        .slice()
        .sort((a, b) => new Date(b.dataEnvio).getTime() - new Date(a.dataEnvio).getTime()),
    [state.propostas]
  )

  const propostasPorTab = useMemo(() => {
    const abertas = propostasOrdenadas.filter((proposta) => openStatuses.includes(proposta.status))
    const fechadas = propostasOrdenadas.filter((proposta) => proposta.status === 'fechado')
    const perdidas = propostasOrdenadas.filter((proposta) => proposta.status === 'perdido')

    return {
      todas: propostasOrdenadas,
      abertas,
      fechadas,
      perdidas,
    }
  }, [propostasOrdenadas])

  const propostasEmAndamento = propostasPorTab.abertas
  const propostasFechadas = propostasPorTab.fechadas
  const propostasPerdidas = propostasPorTab.perdidas

  const totalEmAndamento = propostasEmAndamento.reduce((acc, proposta) => acc + proposta.valor, 0)
  const totalFechado = propostasFechadas.reduce((acc, proposta) => acc + proposta.valor, 0)
  const totalPerdido = propostasPerdidas.reduce((acc, proposta) => acc + proposta.valor, 0)

  const taxaConversao = useMemo(() => {
    if (!state.propostas.length) return '0'
    return ((propostasFechadas.length / state.propostas.length) * 100).toFixed(1)
  }, [propostasFechadas.length, state.propostas.length])

  if (!hasPropostasAccess) {
    return <ModuleAccessState module="propostas" />
  }

  const renderPropostaRow = (proposta: typeof state.propostas[number]) => {
    const cliente = getCliente(proposta.clienteId)
    const canManage =
      user?.role === 'admin' ||
      user?.role === 'gerente' ||
      proposta.responsavelId === user?.id ||
      (
        user?.role === 'orcamentista' &&
        (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
        ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
      )
    const canEditProposal =
      user?.role === 'admin' ||
      user?.role === 'gerente' ||
      (
        user?.role === 'orcamentista' &&
        (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
        ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
      )

    return (
      <TableRow key={proposta.id} className="hover:bg-secondary/30">
        <TableCell>
          {cliente ? (
            <Link
              href={`/clientes/${cliente.id}`}
              className="font-medium text-foreground transition-colors hover:text-primary"
            >
              {cliente.nome}
            </Link>
          ) : (
            <span className="text-muted-foreground">Cliente nao encontrado</span>
          )}
        </TableCell>
        <TableCell className="font-semibold">{formatCurrency(proposta.valor)}</TableCell>
        <TableCell className="max-w-xs truncate text-muted-foreground">{proposta.descricao || '-'}</TableCell>
        <TableCell>
          <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
            {statusPropostaLabels[proposta.status]}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{formatDate(proposta.dataEnvio)}</TableCell>
        <TableCell className="text-muted-foreground">{proposta.responsavelNome || '-'}</TableCell>
        <TableCell className="text-muted-foreground">{proposta.orcamentistaNome || '-'}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEditProposal && (
                <DropdownMenuItem onClick={() => setEditingPropostaId(proposta.id)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar proposta
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDetailsPropostaId(proposta.id)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalhes
              </DropdownMenuItem>
              {canManage && (
                <DropdownMenuItem onClick={() => deleteProposta(proposta.id)} className="text-destructive">
                  <X className="mr-2 h-4 w-4" />
                  Excluir
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    )
  }

  const stats = [
    {
      title: 'Em andamento',
      value: formatCurrency(totalEmAndamento),
      count: propostasEmAndamento.length,
      icon: Clock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Fechadas',
      value: formatCurrency(totalFechado),
      count: propostasFechadas.length,
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Perdidas',
      value: formatCurrency(totalPerdido),
      count: propostasPerdidas.length,
      icon: X,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
    },
    {
      title: 'Taxa de conversao',
      value: `${taxaConversao}%`,
      count: state.propostas.length,
      icon: TrendingUp,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
  ]

  return (
    <>
      <CRMHeader
        title="Propostas"
        subtitle="Gerencie propostas, anexos e historico comercial"
        action={{ label: 'Nova Proposta', onClick: () => setShowCreateDialog(true) }}
      />

      <div className="flex-1 overflow-auto space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-border bg-card">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">
                      {stat.count} proposta{stat.count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className={`rounded-lg p-3 ${stat.bgColor}`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="todas">
          <TabsList className="mb-4">
            {tabs.map((tab) => {
              const count =
                tab.key === 'todas'
                  ? propostasPorTab.todas.length
                  : tab.key === 'abertas'
                    ? propostasPorTab.abertas.length
                    : tab.key === 'fechadas'
                      ? propostasPorTab.fechadas.length
                      : propostasPorTab.perdidas.length
              return (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label} ({count})
                </TabsTrigger>
              )
            })}
          </TabsList>

          {tabs.map((tab) => {
            const propostas =
              tab.key === 'todas'
                ? propostasPorTab.todas
                : tab.key === 'abertas'
                  ? propostasPorTab.abertas
                  : tab.key === 'fechadas'
                    ? propostasPorTab.fechadas
                    : propostasPorTab.perdidas

            return (
              <TabsContent key={tab.key} value={tab.key}>
                <Card className="border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                        <TableHead className="text-foreground">Cliente</TableHead>
                        <TableHead className="text-foreground">Valor</TableHead>
                        <TableHead className="text-foreground">Descricao</TableHead>
                        <TableHead className="text-foreground">Status</TableHead>
                        <TableHead className="text-foreground">Data</TableHead>
                        <TableHead className="text-foreground">Vendedor</TableHead>
                        <TableHead className="text-foreground">Orcamentista</TableHead>
                        <TableHead className="w-12 text-foreground"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {propostas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                            Nenhuma proposta encontrada
                          </TableCell>
                        </TableRow>
                      ) : (
                        propostas.map(renderPropostaRow)
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>
            )
          })}
        </Tabs>
      </div>

      {showCreateDialog ? (
        <ProposalFormDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
      ) : null}
      {editingPropostaId ? (
        <ProposalFormDialog
          open={Boolean(editingPropostaId)}
          onOpenChange={(open) => !open && setEditingPropostaId(null)}
          propostaId={editingPropostaId}
        />
      ) : null}
      {detailsPropostaId ? (
        <ProposalDetailsSheet
          open={Boolean(detailsPropostaId)}
          onOpenChange={(open) => !open && setDetailsPropostaId(null)}
          propostaId={detailsPropostaId}
        />
      ) : null}
    </>
  )
}
