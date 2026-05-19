'use client'

import { useCallback, useMemo, useState } from 'react'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { prefetchProposta, useSession } from '@/lib/hooks/use-api'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
import { ProposalDetailsSheet } from '@/components/crm/propostas/proposal-details-sheet'
import { ProposalFormDialog } from '@/components/crm/propostas/proposal-form-dialog'
import { UserIdentity } from '@/components/crm/user-avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, FileText, Calendar, Paperclip, MessageSquare } from 'lucide-react'
import { sellerReleasedProposalStatuses, statusPropostaColors, statusPropostaLabels, type Proposta } from '@/lib/data/types'

interface ProposalsTabProps {
  clienteId: string
}

export function ProposalsTab({ clienteId }: ProposalsTabProps) {
  const { formatCurrency, formatDate } = useAppSettings()
  const { state, getPropostasByCliente } = useCRM()
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
          ? hasRuleAccess(user, 'allowSellerViewReleasedProposals') &&
            sellerReleasedProposalStatuses.includes(proposta.status)
          : true
      ),
    [clienteId, getPropostasByCliente, user]
  )
  const canCreateProposal = hasRuleAccess(user, 'canCreateProposals')
  const propostasOrdenadas = useMemo(
    () =>
      propostas
        .slice()
        .sort((a, b) => new Date(b.dataEnvio).getTime() - new Date(a.dataEnvio).getTime()),
    [propostas]
  )
  const usuariosById = useMemo(() => new Map(state.usuarios.map((usuario) => [usuario.id, usuario])), [state.usuarios])
  const canEditProposal = (proposta: (typeof propostas)[number]) =>
    user?.role === 'admin' ||
    user?.role === 'gerente' ||
    (
      user?.role === 'orcamentista' &&
      (
        ((!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
          ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)) ||
        (hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
          proposta.orcamentistaId === user.id)
      )
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
                <article
                  key={proposta.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/30"
                >
                  <div className="grid gap-3 p-3.5 lg:grid-cols-[minmax(0,1fr)_16rem_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 rounded-lg border border-primary/20 bg-primary/10 p-2">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {proposta.numero ? <span>{proposta.numero}</span> : null}
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(proposta.dataEnvio)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <p className="text-2xl font-bold tracking-tight text-foreground">
                            {formatCurrency(proposta.valor)}
                          </p>
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
                        <p className="mt-2 line-clamp-1 text-sm leading-relaxed text-muted-foreground">
                          {descriptionPreview || 'Nenhuma descricao registrada.'}
                        </p>
                      </div>
                    </div>

                    <div className="grid min-w-0 gap-1.5">
                        {(() => {
                          const responsavelColor =
                            usuariosById.get(proposta.responsavelId || '')?.avatarColor || '#0EA5E9'
                          return (
                            <div
                              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/15 px-2 py-1.5"
                              style={{
                                borderLeftColor: responsavelColor,
                                borderLeftWidth: 3,
                              }}
                              title={`Vendedor: ${proposta.responsavelNome || '-'}`}
                              aria-label={`Vendedor: ${proposta.responsavelNome || '-'}`}
                            >
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Vend.
                              </span>
                              <UserIdentity
                                name={proposta.responsavelNome}
                                initials={usuariosById.get(proposta.responsavelId || '')?.avatar}
                                color={responsavelColor}
                                className="h-5 w-5"
                                fallbackClassName="text-[9px]"
                                textClassName="max-w-[9rem] text-right font-medium text-foreground/90"
                              />
                            </div>
                          )
                        })()}
                        {(() => {
                          const orcamentistaColor =
                            usuariosById.get(proposta.orcamentistaId || '')?.avatarColor || '#F59E0B'
                          return (
                            <div
                              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/15 px-2 py-1.5"
                              style={{
                                borderLeftColor: orcamentistaColor,
                                borderLeftWidth: 3,
                              }}
                              title={`Orcamentista: ${proposta.orcamentistaNome || '-'}`}
                              aria-label={`Orcamentista: ${proposta.orcamentistaNome || '-'}`}
                            >
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Orc.
                              </span>
                              <UserIdentity
                                name={proposta.orcamentistaNome}
                                initials={usuariosById.get(proposta.orcamentistaId || '')?.avatar}
                                color={orcamentistaColor}
                                className="h-5 w-5"
                                fallbackClassName="text-[9px]"
                                textClassName="max-w-[9rem] text-right font-medium text-foreground/90"
                              />
                            </div>
                          )
                        })()}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                      <Badge
                        variant="outline"
                        className={`${statusPropostaColors[proposta.status]} w-fit max-w-full truncate`}
                      >
                        {statusPropostaLabels[proposta.status]}
                      </Badge>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3.5 w-3.5" />
                          {proposta.anexosCount ?? proposta.anexos?.length ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="h-3.5 w-3.5" />
                          {proposta.comentariosCount ?? proposta.comentarios?.length ?? 0}
                        </span>
                      </div>
                      <div className="flex gap-2">
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
                  </div>
                </article>
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
