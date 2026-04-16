'use client'

import { useEffect, useMemo, useState } from 'react'
import { mutate } from 'swr'
import {
  AlertCircle,
  CalendarClock,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useProposta, useSession } from '@/lib/hooks/use-api'
import { statusPropostaColors, statusPropostaLabels, type Proposta } from '@/lib/data/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

type ProposalCommentSnapshot = {
  id: string
  proposta_id?: string
  propostaId?: string
  usuario_id?: string
  usuarioId?: string
  usuario_nome?: string
  usuarioNome?: string
  comentario: string
  created_at?: string
  criadoEm?: string | Date
}

interface ProposalDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propostaId?: string | null
  propostaInicial?: Proposta | null
}

export function ProposalDetailsSheet({
  open,
  onOpenChange,
  propostaId,
  propostaInicial,
}: ProposalDetailsSheetProps) {
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const {
    proposta,
    isLoading,
    error,
    mutate: mutateProposta,
  } = useProposta(open && propostaId ? propostaId : null)
  const propostaSource = proposta || propostaInicial || null
  const [newComment, setNewComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingComment, setEditingComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const detailErrorMessage = useMemo(() => {
    if (!error) return null
    if (error instanceof Error && error.message) {
      return error.message
    }
    return 'Nao foi possivel carregar os detalhes desta proposta agora.'
  }, [error])

  const syncProposalSnapshot = async (proposalSnapshot: any) => {
    if (!propostaId || !proposalSnapshot) return
    const hasAttachmentDetails = Array.isArray(proposalSnapshot.anexos)
    const hasCommentDetails = Array.isArray(proposalSnapshot.comentarios)
    const hasDetailedCollections = hasAttachmentDetails || hasCommentDetails
    const proposalPatch: Record<string, unknown> = {
      ...proposalSnapshot,
    }

    if (hasAttachmentDetails) {
      const anexos = proposalSnapshot.anexos as any[]
      proposalPatch.anexos = anexos
      proposalPatch.anexosCount = anexos.length
      proposalPatch.anexos_count = anexos.length
    }

    if (hasCommentDetails) {
      const comentarios = proposalSnapshot.comentarios as any[]
      proposalPatch.comentarios = comentarios
      proposalPatch.comentariosCount = comentarios.length
      proposalPatch.comentarios_count = comentarios.length
    }

    if (hasDetailedCollections) {
      await mutate(`/api/propostas/${propostaId}`, proposalPatch, { revalidate: false })
    }
    await mutate(
      (key) => typeof key === 'string' && key.startsWith('/api/crm/bootstrap'),
      (current?: Record<string, unknown> | null) => {
        if (!current || typeof current !== 'object') {
          return current
        }

        const propostas = Array.isArray(current.propostas) ? current.propostas : []
        return {
          ...current,
          propostas: propostas.map((item: any) =>
            item?.id === propostaId ? { ...item, ...proposalPatch } : item
          ),
        }
      },
      { revalidate: false }
    )

    if (hasDetailedCollections) {
      await mutate(
        (key) => typeof key === 'string' && key.startsWith('/api/propostas'),
        (current) => {
          if (Array.isArray(current)) {
            return current.map((item: any) => (item?.id === propostaId ? { ...item, ...proposalPatch } : item))
          }

          if (current && typeof current === 'object' && (current as any).id === propostaId) {
            return { ...current, ...proposalPatch }
          }

          return current
        },
        { revalidate: false }
      )
    }
  }

  const refreshProposalData = async () => {
    const refreshed = await mutateProposta()
    await syncProposalSnapshot(refreshed)
    void mutate((key) => typeof key === 'string' && key.startsWith('/api/propostas'))
  }

  const applyCommentSnapshot = async (
    updater: (comments: ProposalCommentSnapshot[]) => ProposalCommentSnapshot[]
  ) => {
    if (!propostaId) return

    await mutate(
      `/api/propostas/${propostaId}`,
      (current?: Record<string, any> | null) => {
        if (!current || typeof current !== 'object') {
          return current
        }

        const currentComments = Array.isArray(current.comentarios)
          ? (current.comentarios as ProposalCommentSnapshot[])
          : []
        const nextComments = updater(currentComments)

        return {
          ...current,
          comentarios: nextComments,
          comentariosCount: nextComments.length,
          comentarios_count: nextComments.length,
        }
      },
      { revalidate: false }
    )

    await mutate(
      (key) => typeof key === 'string' && key.startsWith('/api/crm/bootstrap'),
      (current?: Record<string, unknown> | null) => {
        if (!current || typeof current !== 'object') {
          return current
        }

        const propostas = Array.isArray(current.propostas) ? current.propostas : []
        return {
          ...current,
          propostas: propostas.map((item: any) => {
            if (item?.id !== propostaId) {
              return item
            }

            const currentCount = Number(
              item?.comentariosCount ?? item?.comentarios_count ?? item?.comentarios?.length ?? 0
            )
            const nextComments = updater(
              Array.isArray(item?.comentarios) ? (item.comentarios as ProposalCommentSnapshot[]) : []
            )
            const nextCount = Array.isArray(item?.comentarios) ? nextComments.length : Math.max(nextComments.length, currentCount)

            return {
              ...item,
              ...(Array.isArray(item?.comentarios) ? { comentarios: nextComments } : {}),
              comentariosCount: nextCount,
              comentarios_count: nextCount,
            }
          }),
        }
      },
      { revalidate: false }
    )
  }

  useEffect(() => {
    if (!open || !propostaId || !proposta) {
      return
    }

    if (!Array.isArray(proposta.anexos) && !Array.isArray(proposta.comentarios)) {
      return
    }

    void syncProposalSnapshot(proposta)
  }, [open, proposta, propostaId])

  const handleCreateComment = async () => {
    if (!propostaId || !newComment.trim()) return

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/propostas/${propostaId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comentario: newComment }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Nao foi possivel registrar o comentario.')
      }

      setNewComment('')
      await applyCommentSnapshot((comments) => [data, ...comments.filter((item) => item.id !== data?.id)])
      await refreshProposalData()
      toast.success('Comentario registrado.')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao registrar comentario.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveComment = async () => {
    if (!propostaId || !editingCommentId || !editingComment.trim()) return

    setIsSubmitting(true)
    try {
      const response = await fetch(
        `/api/propostas/${propostaId}/comentarios/${editingCommentId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comentario: editingComment }),
        }
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Nao foi possivel atualizar o comentario.')
      }

      setEditingCommentId(null)
      setEditingComment('')
      await applyCommentSnapshot((comments) =>
        comments.map((item) => (item.id === editingCommentId ? { ...item, ...data } : item))
      )
      await refreshProposalData()
      toast.success('Comentario atualizado.')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar comentario.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!propostaId) return
    if (typeof window !== 'undefined' && !window.confirm('Excluir este comentario?')) {
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(
        `/api/propostas/${propostaId}/comentarios/${commentId}`,
        { method: 'DELETE' }
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Nao foi possivel excluir o comentario.')
      }

      if (editingCommentId === commentId) {
        setEditingCommentId(null)
        setEditingComment('')
      }

      await applyCommentSnapshot((comments) => comments.filter((item) => item.id !== commentId))
      await refreshProposalData()
      toast.success('Comentario removido.')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir comentario.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!propostaId) return
    if (typeof window !== 'undefined' && !window.confirm('Excluir este anexo?')) {
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(
        `/api/propostas/${propostaId}/anexos/${attachmentId}`,
        { method: 'DELETE' }
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Nao foi possivel excluir o anexo.')
      }

      await refreshProposalData()
      toast.success('Anexo removido.')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir anexo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>Detalhes da Proposta</SheetTitle>
          <SheetDescription>
            Visualize o andamento, arquivos e o historico de comentarios desta proposta.
          </SheetDescription>
        </SheetHeader>

        {propostaSource ? (
          <div className="grid flex-1 gap-6 overflow-hidden px-4 pb-4 lg:grid-cols-[1.05fr_0.95fr]">
            <ScrollArea className="h-[calc(100vh-9rem)] pr-4">
              <div className="space-y-6">
                <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {propostaSource.numero || 'Proposta Comercial'}
                      </p>
                      <h3 className="text-xl font-semibold text-foreground">
                        {propostaSource.titulo || 'Proposta Comercial'}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Cliente: {propostaSource.clienteNome || 'Nao informado'}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusPropostaColors[propostaSource.status]}>
                      {statusPropostaLabels[propostaSource.status]}
                    </Badge>
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {formatCurrency(propostaSource.valor)}
                  </p>
                  {propostaSource.descricao ? (
                    <p className="text-sm leading-6 text-muted-foreground">{propostaSource.descricao}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma descricao adicional foi registrada.
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <InfoCard
                    title="Vendedor Responsavel"
                    value={propostaSource.responsavelNome || '-'}
                    subtitle="Responsavel comercial"
                  />
                  <InfoCard
                    title="Orcamentista"
                    value={propostaSource.orcamentistaNome || '-'}
                    subtitle="Responsavel pelo orcamento"
                  />
                  <InfoCard
                    title="Retificacoes"
                    value={String(propostaSource.retificacoesCount || 0)}
                    subtitle="Quantidade de retornos para ajuste"
                  />
                  <InfoCard
                    title="Anexos"
                    value={String(propostaSource.anexos?.length ?? propostaSource.anexosCount ?? 0)}
                    subtitle="Arquivos vinculados a proposta"
                  />
                  <InfoCard
                    title="Comentarios"
                    value={String(propostaSource.comentarios?.length ?? propostaSource.comentariosCount ?? 0)}
                    subtitle="Atualizacoes registradas"
                  />
                </div>

                <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    Linha do tempo
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>Criada em {formatDateTime(propostaSource.criadoEm)}</p>
                    {propostaSource.followUpBaseAt ? (
                      <p>Base do follow-up em {formatDateTime(propostaSource.followUpBaseAt)}</p>
                    ) : null}
                    {propostaSource.followUpTime ? <p>Horario planejado do follow-up: {propostaSource.followUpTime.slice(0, 5)}</p> : null}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    Anexos
                  </div>
                  {propostaSource.anexos?.length ? (
                    <div className="space-y-2">
                      {propostaSource.anexos.map((anexo) => (
                        <a
                          key={anexo.id}
                          href={anexo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-secondary/30"
                        >
                          <span className="truncate">{anexo.nome}</span>
                          <div className="ml-3 flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {Math.max(1, Math.round(anexo.tamanho / 1024))} KB
                            </span>
                            {(user?.role === 'admin' ||
                              user?.role === 'gerente' ||
                              anexo.usuarioId === user?.id) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={(event) => {
                                  event.preventDefault()
                                  void handleDeleteAttachment(anexo.id)
                                }}
                                disabled={isSubmitting}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhum arquivo anexado nesta proposta.
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>

            <div className="flex h-[calc(100vh-9rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Comentarios da Proposta</p>
                  <p className="text-xs text-muted-foreground">
                    Conversa operacional e historico de decisoes desta proposta.
                  </p>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 px-4 py-4">
                <div className="space-y-4">
                  {propostaSource.comentarios?.length ? (
                    propostaSource.comentarios.map((item) => {
                      const canManageComment =
                        user?.role === 'admin' ||
                        user?.role === 'gerente' ||
                        item.usuarioId === user?.id

                      return (
                        <div key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-secondary/20 p-4">
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2 text-sm font-medium text-foreground">
                              <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{item.usuarioNome || 'Usuario'}</span>
                            </div>
                            {canManageComment && (
                              <div className="shrink-0 flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingCommentId(item.id)
                                    setEditingComment(item.comentario)
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => void handleDeleteComment(item.id)}
                                  disabled={isSubmitting}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>

                          {editingCommentId === item.id ? (
                            <div className="space-y-3">
                              <Textarea
                                rows={4}
                                value={editingComment}
                                onChange={(event) => setEditingComment(event.target.value)}
                                placeholder="Atualize o comentario..."
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingCommentId(null)
                                    setEditingComment('')
                                  }}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => void handleSaveComment()}
                                  disabled={isSubmitting || !editingComment.trim()}
                                >
                                  Salvar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="max-h-56 overflow-y-auto pr-1">
                              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                                {item.comentario}
                              </p>
                            </div>
                          )}

                          <p className="mt-3 text-xs text-muted-foreground">
                            {formatDateTime(item.criadoEm)}
                          </p>
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      Nenhum comentario registrado ainda.
                    </div>
                  )}
                </div>
              </ScrollArea>

              <Separator />

              <div className="space-y-3 px-4 py-4">
                <Textarea
                  rows={4}
                  placeholder="Adicionar comentario..."
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void handleCreateComment()}
                    disabled={isSubmitting || !newComment.trim()}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Registrar comentario
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Carregando detalhes da proposta...
          </div>
        ) : detailErrorMessage ? (
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex max-w-md items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">Nao foi possivel abrir os detalhes agora.</p>
                <p className="mt-1">{detailErrorMessage}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Nenhum detalhe desta proposta foi encontrado.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string
  subtitle: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 text-base font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
