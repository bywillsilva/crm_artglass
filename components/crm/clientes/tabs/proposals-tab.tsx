'use client'

import { useCallback, useMemo, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { prefetchProposta, useSession } from '@/lib/hooks/use-api'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
import { ProposalDetailsSheet } from '@/components/crm/propostas/proposal-details-sheet'
import { ProposalFormDialog } from '@/components/crm/propostas/proposal-form-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, FileText, Calendar, Paperclip, MessageSquare, UserRound, BriefcaseBusiness } from 'lucide-react'
import { sellerReleasedProposalStatuses, statusPropostaColors, statusPropostaLabels, type Proposta } from '@/lib/data/types'

interface ProposalsTabProps {
  clienteId: string
}

export function ProposalsTab({ clienteId }: ProposalsTabProps) {
  const { formatCurrency, formatDate } = useAppSettings()
  const { getPropostasByCliente } = useCRM()
  const { user } = useSession()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [editingPropostaSnapshot, setEditingPropostaSnapshot] = useState<Proposta | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)
  const [detailsPropostaSnapshot, setDetailsPropostaSnapshot] = useState<Proposta | null>(null)
  const openProposalDetails = useCallback((proposal: Proposta) => {
    void prefetchProposta(proposal.id)
    setDetailsPropostaId(proposal.id)
    setDetailsPropostaSnapshot(proposal)
  }, [])

  const propostas = useMemo(
    () =>
      getPropostasByCliente(clienteId).filter((proposta) =>
        user?.role === 'vendedor'
          ? sellerReleasedProposalStatuses.includes(proposta.status)
          : true
      ),
    [clienteId, getPropostasByCliente, user?.role]
  )
  const canCreateProposal = user?.role !== 'vendedor'
  const propostasOrdenadas = useMemo(
    () =>
      propostas
        .slice()
        .sort((a, b) => new Date(b.dataEnvio).getTime() - new Date(a.dataEnvio).getTime()),
    [propostas]
  )
  const canEditProposal = (proposta: (typeof propostas)[number]) =>
    user?.role === 'admin' ||
    user?.role === 'gerente' ||
    (
      user?.role === 'orcamentista' &&
      (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
      ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
    )

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Propostas</CardTitle>
          {canCreateProposal ? (
            <Button size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Proposta
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {propostas.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhuma proposta registrada</p>
          ) : (
            <div className="space-y-3">
              {propostasOrdenadas.map((proposta) => {
                const materialTags = parseProposalMaterialTags(proposta.materialTag)
                const visibleMaterialTags = materialTags.slice(0, 3)
                const extraMaterialTagsCount = Math.max(materialTags.length - visibleMaterialTags.length, 0)
                const descriptionPreview = (proposta.descricao || '').replace(/\s+/g, ' ').trim()

                return (
                <div
                  key={proposta.id}
                  className="rounded-xl border border-border bg-card/80 p-3.5 shadow-sm transition-colors hover:border-primary/25"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {proposta.numero ? <span>{proposta.numero}</span> : null}
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(proposta.dataEnvio)}
                        </span>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <div className="rounded-lg bg-primary/12 p-2">
                          <FileText className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-1">
                              <p className="text-xl font-bold tracking-tight text-foreground">
                                {formatCurrency(proposta.valor)}
                              </p>
                              <div className="flex flex-wrap gap-1">
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
                            </div>
                            <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
                              {statusPropostaLabels[proposta.status]}
                            </Badge>
                          </div>

                          <div className="grid gap-1.5 text-[11px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                            <span className="inline-flex items-center gap-1.5">
                              <UserRound className="h-3.5 w-3.5" />
                              Vend.: {proposta.responsavelNome || '-'}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <BriefcaseBusiness className="h-3.5 w-3.5" />
                              Orc.: {proposta.orcamentistaNome || '-'}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Paperclip className="h-3.5 w-3.5" />
                              {proposta.anexosCount ?? proposta.anexos?.length ?? 0} anexos
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {proposta.comentariosCount ?? proposta.comentarios?.length ?? 0} comentarios
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {descriptionPreview ? (
                    <p className="mb-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
                      {descriptionPreview}
                    </p>
                  ) : (
                    <p className="mb-3 text-sm text-muted-foreground">Nenhuma descricao registrada.</p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPointerEnter={() => void prefetchProposta(proposta.id)}
                      onFocus={() => void prefetchProposta(proposta.id)}
                      onClick={() => openProposalDetails(proposta)}
                    >
                      Ver detalhes
                    </Button>
                    {canEditProposal(proposta) && (
                      <Button size="sm" variant="outline" onClick={() => {
                        void prefetchProposta(proposta.id)
                        setEditingPropostaId(proposta.id)
                        setEditingPropostaSnapshot(proposta)
                      }}>
                        Editar
                      </Button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {canCreateProposal ? (
        <ProposalFormDialog
          open={showAddForm}
          onOpenChange={setShowAddForm}
          clienteIdInicial={clienteId}
        />
      ) : null}
      {editingPropostaId ? (
        <ProposalFormDialog
          key={editingPropostaId}
          open={Boolean(editingPropostaId)}
          onOpenChange={(open) => {
            if (open) return
            setEditingPropostaId(null)
            setEditingPropostaSnapshot(null)
          }}
          propostaId={editingPropostaId}
          propostaInicial={
            propostas.find((proposta) => proposta.id === editingPropostaId) ??
            editingPropostaSnapshot
          }
        />
      ) : null}
      <ProposalDetailsSheet
        open={Boolean(detailsPropostaId)}
        onOpenChange={(open) => {
          if (open) return
          setDetailsPropostaId(null)
          setDetailsPropostaSnapshot(null)
        }}
        propostaId={detailsPropostaId}
        propostaInicial={
          propostas.find((proposta) => proposta.id === detailsPropostaId) ??
          detailsPropostaSnapshot
        }
      />
    </>
  )
}
