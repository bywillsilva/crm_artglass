'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { prefetchProposta, useSession } from '@/lib/hooks/use-api'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
import { CRMHeader } from '@/components/crm/header'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
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

const PAGE_SIZE_OPTIONS = [10, 50, 100] as const

function getDescriptionPreview(value?: string | null, maxLength = 72) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

export default function PropostasPage() {
  const { state, getCliente, deleteProposta } = useCRM()
  const { formatCurrency, formatDate } = useAppSettings()
  const { user } = useSession()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('todas')
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [currentPage, setCurrentPage] = useState(1)
  const openProposalDetails = (proposalId: string) => {
    void prefetchProposta(proposalId)
    setDetailsPropostaId(proposalId)
  }
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
  const editingProposta = editingPropostaId
    ? state.propostas.find((proposta) => proposta.id === editingPropostaId) ?? null
    : null
  const detailsProposta = detailsPropostaId
    ? state.propostas.find((proposta) => proposta.id === detailsPropostaId) ?? null
    : null

  const totalEmAndamento = propostasEmAndamento.reduce((acc, proposta) => acc + proposta.valor, 0)
  const totalFechado = propostasFechadas.reduce((acc, proposta) => acc + proposta.valor, 0)
  const totalPerdido = propostasPerdidas.reduce((acc, proposta) => acc + proposta.valor, 0)

  const taxaConversao = useMemo(() => {
    if (!state.propostas.length) return '0'
    return ((propostasFechadas.length / state.propostas.length) * 100).toFixed(1)
  }, [propostasFechadas.length, state.propostas.length])

  const propostasAtivasNaTab = propostasPorTab[activeTab as keyof typeof propostasPorTab] ?? []
  const totalPages = Math.max(1, Math.ceil(propostasAtivasNaTab.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const paginatedPropostas = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize
    return propostasAtivasNaTab.slice(startIndex, startIndex + pageSize)
  }, [pageSize, propostasAtivasNaTab, safeCurrentPage])
  const paginationStart = propostasAtivasNaTab.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1
  const paginationEnd = propostasAtivasNaTab.length === 0 ? 0 : paginationStart + paginatedPropostas.length - 1

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, pageSize])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  if (!hasPropostasAccess) {
    return <ModuleAccessState module="propostas" />
  }

  const buildPageItems = (page: number, total: number) => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1)
    }

    if (page <= 3) {
      return [1, 2, 3, 4, 'ellipsis-end', total] as const
    }

    if (page >= total - 2) {
      return [1, 'ellipsis-start', total - 3, total - 2, total - 1, total] as const
    }

    return [1, 'ellipsis-start', page - 1, page, page + 1, 'ellipsis-end', total] as const
  }

  const renderPropostaRow = (proposta: typeof state.propostas[number]) => {
    const cliente = getCliente(proposta.clienteId)
    const materialTags = parseProposalMaterialTags(proposta.materialTag)
    const visibleMaterialTags = materialTags.slice(0, 2)
    const extraMaterialTagsCount = Math.max(materialTags.length - visibleMaterialTags.length, 0)
    const descriptionPreview = getDescriptionPreview(proposta.descricao)
    const clientName = cliente?.nome || proposta.clienteNome || 'Cliente nao encontrado'
    const canDeleteProposal =
      user?.role === 'admin' ||
      user?.role === 'gerente' ||
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
        <TableCell className="min-w-[20rem]">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {cliente ? (
                  <Link
                    href={`/clientes/${cliente.id}`}
                    className="block truncate font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {clientName}
                  </Link>
                ) : (
                  <span className="block truncate font-medium text-foreground">{clientName}</span>
                )}
              </div>
              {visibleMaterialTags.length ? (
                <div className="flex max-w-[12rem] flex-wrap justify-end gap-1">
                  {visibleMaterialTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="h-auto border border-border/60 bg-secondary/55 px-2 py-0.5 text-[10px] uppercase tracking-wide text-secondary-foreground/90"
                    >
                      {tag}
                    </Badge>
                  ))}
                  {extraMaterialTagsCount > 0 ? (
                    <Badge variant="outline" className="h-auto px-2 py-0.5 text-[10px]">
                      +{extraMaterialTagsCount}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
            {descriptionPreview ? (
              <p className="max-w-[28rem] text-xs leading-relaxed text-muted-foreground">{descriptionPreview}</p>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap font-semibold">{formatCurrency(proposta.valor)}</TableCell>
        <TableCell>
          <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
            {statusPropostaLabels[proposta.status]}
          </Badge>
        </TableCell>
        <TableCell className="min-w-[12rem]">
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Vend.</span>
              <span className="truncate text-right text-foreground">{proposta.responsavelNome || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Orc.</span>
              <span className="truncate text-right text-foreground">{proposta.orcamentistaNome || '-'}</span>
            </div>
          </div>
        </TableCell>
        <TableCell className="min-w-[9rem] text-sm">
          <div className="space-y-1">
            <p className="font-medium text-foreground">{proposta.numero}</p>
            <p className="text-muted-foreground">{formatDate(proposta.dataEnvio)}</p>
          </div>
        </TableCell>
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
              <DropdownMenuItem onPointerEnter={() => void prefetchProposta(proposta.id)} onFocus={() => void prefetchProposta(proposta.id)} onClick={() => openProposalDetails(proposta.id)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalhes
              </DropdownMenuItem>
              {canDeleteProposal && (
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

  const renderPropostaCard = (proposta: typeof state.propostas[number]) => {
    const cliente = getCliente(proposta.clienteId)
    const materialTags = parseProposalMaterialTags(proposta.materialTag)
    const visibleMaterialTags = materialTags.slice(0, 2)
    const extraMaterialTagsCount = Math.max(materialTags.length - visibleMaterialTags.length, 0)
    const descriptionPreview = getDescriptionPreview(proposta.descricao, 96)
    const clientName = cliente?.nome || proposta.clienteNome || 'Cliente nao encontrado'
    const canDeleteProposal =
      user?.role === 'admin' ||
      user?.role === 'gerente' ||
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
      <Card key={proposta.id} className="border-border bg-card md:hidden">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {cliente ? (
                    <Link
                      href={`/clientes/${cliente.id}`}
                      className="block truncate font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {clientName}
                    </Link>
                  ) : (
                    <p className="truncate text-sm text-foreground">{clientName}</p>
                  )}
                </div>
                {visibleMaterialTags.length ? (
                  <div className="flex max-w-[9rem] flex-wrap justify-end gap-1">
                    {visibleMaterialTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="h-auto border border-border/60 bg-secondary/55 px-2 py-0.5 text-[10px] uppercase tracking-wide text-secondary-foreground/90"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {extraMaterialTagsCount > 0 ? (
                      <Badge variant="outline" className="h-auto px-2 py-0.5 text-[10px]">
                        +{extraMaterialTagsCount}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{proposta.numero} - {formatDate(proposta.dataEnvio)}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
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
                <DropdownMenuItem onPointerEnter={() => void prefetchProposta(proposta.id)} onFocus={() => void prefetchProposta(proposta.id)} onClick={() => openProposalDetails(proposta.id)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalhes
                </DropdownMenuItem>
                {canDeleteProposal && (
                  <DropdownMenuItem onClick={() => deleteProposta(proposta.id)} className="text-destructive">
                    <X className="mr-2 h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
              {statusPropostaLabels[proposta.status]}
            </Badge>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">{formatCurrency(proposta.valor)}</p>
            {descriptionPreview ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{descriptionPreview}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Vendedor</p>
              <p className="truncate text-foreground">{proposta.responsavelNome || '-'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Orcamentista</p>
              <p className="truncate text-foreground">{proposta.orcamentistaNome || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
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

      <div className="flex-1 overflow-auto space-y-4 p-4 sm:space-y-6 sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.title} className="border-border bg-card">
              <CardContent className="p-4 sm:p-6">
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

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as (typeof tabs)[number]['key'])}>
          <TabsList className="mb-4 flex h-auto w-full max-w-full flex-nowrap overflow-x-auto">
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
            const isActiveTab = tab.key === activeTab
            const visiblePropostas = isActiveTab ? paginatedPropostas : propostas
            const shouldShowPagination = isActiveTab && propostas.length > pageSize
            const pageItems = isActiveTab ? buildPageItems(safeCurrentPage, totalPages) : []

            return (
              <TabsContent key={tab.key} value={tab.key}>
                {propostas.length === 0 ? (
                  <Card className="border-border bg-card">
                    <CardContent className="py-8 text-center text-muted-foreground">
                      Nenhuma proposta encontrada
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden">
                      {visiblePropostas.map(renderPropostaCard)}
                    </div>
                    <Card className="hidden border-border bg-card md:block">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                              <TableHead className="text-foreground">Cliente</TableHead>
                              <TableHead className="text-foreground">Valor</TableHead>
                              <TableHead className="text-foreground">Status</TableHead>
                              <TableHead className="text-foreground">Responsaveis</TableHead>
                              <TableHead className="text-foreground">Registro</TableHead>
                              <TableHead className="w-12 text-foreground"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>{visiblePropostas.map(renderPropostaRow)}</TableBody>
                        </Table>
                      </div>
                    </Card>
                    {isActiveTab ? (
                      <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                          <p>
                            Exibindo {paginationStart}-{paginationEnd} de {propostas.length} propostas
                          </p>
                          <div className="flex items-center gap-2">
                            <span>Por pagina</span>
                            <Select
                              value={String(pageSize)}
                              onValueChange={(value) => setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                            >
                              <SelectTrigger className="h-8 w-[118px] text-xs">
                                <SelectValue placeholder="Quantidade" />
                              </SelectTrigger>
                              <SelectContent>
                                {PAGE_SIZE_OPTIONS.map((option) => (
                                  <SelectItem key={option} value={String(option)}>
                                    {option} propostas
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {shouldShowPagination ? (
                          <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                            <PaginationContent>
                              <PaginationItem>
                                <PaginationPrevious
                                  href="#"
                                  className={safeCurrentPage <= 1 ? 'pointer-events-none opacity-50' : ''}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    if (safeCurrentPage > 1) {
                                      setCurrentPage((page) => page - 1)
                                    }
                                  }}
                                />
                              </PaginationItem>
                              {pageItems.map((item, index) => (
                                <PaginationItem key={`${item}-${index}`}>
                                  {item === 'ellipsis-start' || item === 'ellipsis-end' ? (
                                    <PaginationEllipsis />
                                  ) : (
                                    <PaginationLink
                                      href="#"
                                      isActive={safeCurrentPage === item}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        setCurrentPage(Number(item))
                                      }}
                                    >
                                      {item}
                                    </PaginationLink>
                                  )}
                                </PaginationItem>
                              ))}
                              <PaginationItem>
                                <PaginationNext
                                  href="#"
                                  className={safeCurrentPage >= totalPages ? 'pointer-events-none opacity-50' : ''}
                                  onClick={(event) => {
                                    event.preventDefault()
                                    if (safeCurrentPage < totalPages) {
                                      setCurrentPage((page) => page + 1)
                                    }
                                  }}
                                />
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
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
          propostaInicial={editingProposta}
        />
      ) : null}
      {detailsPropostaId ? (
        <ProposalDetailsSheet
          open={Boolean(detailsPropostaId)}
          onOpenChange={(open) => !open && setDetailsPropostaId(null)}
          propostaId={detailsPropostaId}
          propostaInicial={detailsProposta}
        />
      ) : null}
    </>
  )
}
