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
import { prefetchProposta, updateProposta, useProposta, useSession } from '@/lib/hooks/use-api'
import { statusPropostaColors, statusPropostaLabels, type Proposta } from '@/lib/data/types'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
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

type ProposalAttachmentSnapshot = {
  id: string
  nome: string
  url?: string
  tamanho: number
  tipoMime?: string
  usuarioId?: string
}

interface ProposalDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propostaId?: string | null
  propostaInicial?: Proposta | null
}

function isProposalCollectionKey(key: unknown) {
  return typeof key === 'string' && (key === '/api/propostas' || key.startsWith('/api/propostas?'))
}

function pickProposalValue<T>(primary: T | null | undefined, fallback: T | null | undefined) {
  if (typeof primary === 'string') {
    return (primary.trim() ? primary : fallback) as T | null | undefined
  }

  if (primary === null || primary === undefined) {
    return fallback
  }

  return primary
}

function mergeProposalSnapshot(primary: Proposta, fallback: Proposta) {
  return {
    ...fallback,
    ...primary,
    clienteId: pickProposalValue(primary.clienteId, fallback.clienteId) || '',
    clienteNome: pickProposalValue(primary.clienteNome, fallback.clienteNome) || '',
    numero: pickProposalValue(primary.numero, fallback.numero) || '',
    titulo: pickProposalValue(primary.titulo, fallback.titulo) || 'Proposta Comercial',
    materialTag: pickProposalValue(primary.materialTag, fallback.materialTag) || null,
    descricao: pickProposalValue(primary.descricao, fallback.descricao) || '',
    status: pickProposalValue(primary.status, fallback.status) || 'novo_cliente',
    responsavelId: pickProposalValue(primary.responsavelId, fallback.responsavelId) || '',
    responsavelNome: pickProposalValue(primary.responsavelNome, fallback.responsavelNome) || '',
    orcamentistaId: pickProposalValue(primary.orcamentistaId, fallback.orcamentistaId) || '',
    orcamentistaNome: pickProposalValue(primary.orcamentistaNome, fallback.orcamentistaNome) || '',
    valor:
      typeof primary.valor === 'number' && primary.valor > 0
        ? primary.valor
        : typeof fallback.valor === 'number'
          ? fallback.valor
          : 0,
    anexos: primary.anexos ?? fallback.anexos,
    comentarios: primary.comentarios ?? fallback.comentarios,
  } satisfies Proposta
}

function getProposalDisplayTitle(proposta: Proposta | null) {
  if (!proposta) {
    return 'Proposta Comercial'
  }

  const rawTitle = (proposta.titulo || '').trim()
  const clientName = proposta.clienteNome?.trim() || ''
  const isLegacyNewClientTitle =
    rawTitle === 'Novo cliente' || rawTitle.startsWith('Novo cliente -')

  if ((proposta.status === 'novo_cliente' || isLegacyNewClientTitle) && clientName) {
    return clientName
  }

  return rawTitle || 'Proposta Comercial'
}

function parseCurrencyInput(value: string) {
  const normalized = value
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatCurrencyInputValue(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

type InlineProposalUpdatePayload = Record<string, unknown>

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
  const activeProposal = useMemo(
    () => (proposta && (!propostaId || proposta.id === propostaId) ? proposta : null),
    [proposta, propostaId]
  )
  const activeInitialProposal = useMemo(
    () => (propostaInicial && (!propostaId || propostaInicial.id === propostaId) ? propostaInicial : null),
    [propostaId, propostaInicial]
  )
  const propostaSource = useMemo(() => {
    if (activeProposal && activeInitialProposal) {
      return mergeProposalSnapshot(activeProposal, activeInitialProposal)
    }

    return activeProposal || activeInitialProposal || null
  }, [activeInitialProposal, activeProposal])
  const [newComment, setNewComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingComment, setEditingComment] = useState('')
  const [isEditingValue, setIsEditingValue] = useState(false)
  const [editingValue, setEditingValue] = useState('')
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editingDescription, setEditingDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const detailErrorMessage = useMemo(() => {
    if (!error) return null
    if (error instanceof Error && error.message) {
      return error.message
    }
    return 'Nao foi possivel carregar os detalhes desta proposta agora.'
  }, [error])
  const displayTitle = useMemo(() => getProposalDisplayTitle(propostaSource), [propostaSource])
  const displayClientName = useMemo(() => propostaSource?.clienteNome?.trim() || '', [propostaSource])
  const materialTags = useMemo(
    () => parseProposalMaterialTags(propostaSource?.materialTag),
    [propostaSource?.materialTag]
  )
  const shouldShowClientLine = useMemo(() => {
    if (!displayClientName) return false
    return displayTitle.trim() !== displayClientName
  }, [displayClientName, displayTitle])

  useEffect(() => {
    setNewComment('')
    setEditingCommentId(null)
    setEditingComment('')
    setIsEditingValue(false)
    setEditingValue('')
    setIsEditingDescription(false)
    setEditingDescription('')
  }, [propostaId])

  useEffect(() => {
    if (!propostaSource) {
      return
    }

    if (!isEditingValue) {
      setEditingValue(formatCurrencyInputValue(propostaSource.valor || 0))
    }

    if (!isEditingDescription) {
      setEditingDescription(propostaSource.descricao || '')
    }
  }, [isEditingDescription, isEditingValue, propostaSource])

  useEffect(() => {
    if (!open || !propostaId) {
      return
    }

    void prefetchProposta(propostaId)
  }, [open, propostaId])

  const buildAttachmentHref = (attachmentId: string) =>
    propostaId ? `/api/propostas/${propostaId}/anexos/${attachmentId}` : '#'

  const canInlineEdit = useMemo(() => {
    if (!user || !propostaSource) return false
    if (user.role === 'admin' || user.role === 'gerente') return true
    if (user.role === 'vendedor') return propostaSource.responsavelId === user.id
    if (user.role === 'orcamentista') {
      return !propostaSource.orcamentistaId || propostaSource.orcamentistaId === user.id
    }
    return false
  }, [propostaSource, user])

  const buildInlineUpdatePayload = (overrides: InlineProposalUpdatePayload = {}) => {
    if (!propostaSource) return null

    const propostaSourceRecord = propostaSource as Proposta & {
      desconto?: number
      validade?: string | null
      servicos?: unknown[]
      condicoes?: string | null
    }

    return {
      clienteId: propostaSource.clienteId,
      titulo: propostaSource.titulo || 'Proposta Comercial',
      materialTag: propostaSource.materialTag || null,
      descricao: propostaSource.descricao || '',
      valor: propostaSource.valor,
      desconto: propostaSourceRecord.desconto ?? 0,
      status: propostaSource.status,
      validade: propostaSourceRecord.validade || null,
      servicos: propostaSourceRecord.servicos || [],
      condicoes: propostaSourceRecord.condicoes || null,
      responsavelId: propostaSource.responsavelId || undefined,
      orcamentistaId: propostaSource.orcamentistaId || undefined,
      followUpTime: propostaSource.followUpTime || null,
      ...overrides,
    } satisfies InlineProposalUpdatePayload
  }

  const syncProposalSnapshot = async (proposalSnapshot: any) => {
    if (!propostaId || !proposalSnapshot) return
    const hasAttachmentDetails = Array.isArray(proposalSnapshot.anexos)
    const hasCommentDetails = Array.isArray(proposalSnapshot.comentarios)
    const hasDetailedCollections = hasAttachmentDetails || hasCommentDetails
    const proposalPatch: Record<string, unknown> = {}
    const proposalCollectionPatch: Record<string, unknown> = {}

    if (hasAttachmentDetails) {
      const anexos = proposalSnapshot.anexos as any[]
      proposalPatch.anexos = anexos
      proposalPatch.anexosCount = anexos.length
      proposalPatch.anexos_count = anexos.length
      proposalCollectionPatch.anexosCount = anexos.length
      proposalCollectionPatch.anexos_count = anexos.length
    }

    if (hasCommentDetails) {
      const comentarios = proposalSnapshot.comentarios as any[]
      proposalPatch.comentarios = comentarios
      proposalPatch.comentariosCount = comentarios.length
      proposalPatch.comentarios_count = comentarios.length
      proposalCollectionPatch.comentariosCount = comentarios.length
      proposalCollectionPatch.comentarios_count = comentarios.length
    }

    if (!hasDetailedCollections) {
      return
    }

    await mutate(
      `/api/propostas/${propostaId}`,
      (current?: Record<string, unknown> | null) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          return current
        }

        return {
          ...current,
          ...proposalPatch,
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
          propostas: propostas.map((item: any) =>
            item?.id === propostaId ? { ...item, ...proposalCollectionPatch } : item
          ),
        }
      },
      { revalidate: false }
    )

    await mutate(
      (key) => isProposalCollectionKey(key),
      (current) => {
        if (Array.isArray(current)) {
          return current.map((item: any) =>
            item?.id === propostaId ? { ...item, ...proposalCollectionPatch } : item
          )
        }

        return current
      },
      { revalidate: false }
    )
  }

  const refreshProposalData = async () => {
    const refreshed = await mutateProposta()
    await syncProposalSnapshot(refreshed)
    void mutate((key) => isProposalCollectionKey(key))
  }

  const handleSaveValue = async () => {
    if (!propostaId || !propostaSource) return

    const parsedValue = parseCurrencyInput(editingValue)
    if (parsedValue === null || parsedValue < 0) {
      toast.error('Informe um valor valido para a proposta.')
      return
    }

    const payload = buildInlineUpdatePayload({ valor: parsedValue })
    if (!payload) return

    setIsSubmitting(true)
    try {
      await updateProposta(propostaId, payload)
      setIsEditingValue(false)
      await refreshProposalData()
      toast.success('Valor da proposta atualizado.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar valor da proposta.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveDescription = async () => {
    if (!propostaId || !propostaSource) return

    const payload = buildInlineUpdatePayload({ descricao: editingDescription })
    if (!payload) return

    setIsSubmitting(true)
    try {
      await updateProposta(propostaId, payload)
      setIsEditingDescription(false)
      await refreshProposalData()
      toast.success('Descricao da proposta atualizada.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar descricao da proposta.')
    } finally {
      setIsSubmitting(false)
    }
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
            const nextCount = Array.isArray(item?.comentarios)
              ? nextComments.length
              : Math.max(nextComments.length, currentCount)

            return {
              ...item,
              comentariosCount: nextCount,
              comentarios_count: nextCount,
            }
          }),
        }
      },
      { revalidate: false }
    )
  }

  const applyAttachmentSnapshot = async (
    updater: (attachments: ProposalAttachmentSnapshot[]) => ProposalAttachmentSnapshot[]
  ) => {
    if (!propostaId) return

    await mutate(
      `/api/propostas/${propostaId}`,
      (current?: Record<string, any> | null) => {
        if (!current || typeof current !== 'object') {
          return current
        }

        const currentAttachments = Array.isArray(current.anexos)
          ? (current.anexos as ProposalAttachmentSnapshot[])
          : []
        const nextAttachments = updater(currentAttachments)

        return {
          ...current,
          anexos: nextAttachments,
          anexosCount: nextAttachments.length,
          anexos_count: nextAttachments.length,
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

            const currentCount = Number(item?.anexosCount ?? item?.anexos_count ?? item?.anexos?.length ?? 0)
            const nextAttachments = updater(
              Array.isArray(item?.anexos) ? (item.anexos as ProposalAttachmentSnapshot[]) : []
            )
            const nextCount = Array.isArray(item?.anexos)
              ? nextAttachments.length
              : Math.max(nextAttachments.length, currentCount)

            return {
              ...item,
              anexosCount: nextCount,
              anexos_count: nextCount,
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

      await applyAttachmentSnapshot((attachments) => attachments.filter((item) => item.id !== attachmentId))
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
      <SheetContent key={propostaId || 'proposal-details'} side="right" className="w-full overflow-x-hidden sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>Detalhes da Proposta</SheetTitle>
          <SheetDescription>
            Visualize o andamento, arquivos e o historico de comentarios desta proposta.
          </SheetDescription>
        </SheetHeader>

        {propostaSource ? (
          <div className="grid min-w-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto px-3 pb-4 sm:px-4 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:overflow-hidden">
            <ScrollArea className="h-auto min-w-0 pr-0 lg:h-[calc(100vh-9rem)] lg:pr-4">
              <div className="min-w-0 space-y-4 sm:space-y-6">
                <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {propostaSource.numero || 'Proposta Comercial'}
                      </p>
                      <h3 className="break-words text-xl font-semibold text-foreground">
                        {displayTitle}
                      </h3>
                      {shouldShowClientLine ? (
                        <p className="mt-1 break-words text-sm text-muted-foreground">
                          Cliente: {displayClientName}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline" className={`max-w-full whitespace-normal break-words text-center ${statusPropostaColors[propostaSource.status]}`}>
                      {statusPropostaLabels[propostaSource.status]}
                    </Badge>
                  </div>
                  {materialTags.length ? (
                    <div className="flex flex-wrap gap-2">
                      {materialTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="h-auto px-2 py-0.5 text-[10px] uppercase tracking-wide">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {isEditingValue ? (
                    <div className="space-y-3">
                      <div className="inline-flex max-w-full items-center gap-2">
                        <span className="text-3xl font-bold text-foreground">R$</span>
                        <input
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void handleSaveValue()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setIsEditingValue(false)
                              setEditingValue(formatCurrencyInputValue(propostaSource.valor || 0))
                            }
                          }}
                          placeholder="0,00"
                          inputMode="decimal"
                          autoFocus
                          style={{ width: `${Math.max(editingValue.length + 1, 4)}ch` }}
                          className="min-w-0 border-0 bg-transparent p-0 text-3xl font-bold leading-none tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsEditingValue(false)
                            setEditingValue(formatCurrencyInputValue(propostaSource.valor || 0))
                          }}
                          disabled={isSubmitting}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={() => void handleSaveValue()} disabled={isSubmitting}>
                          Salvar valor
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-left"
                      onClick={() => canInlineEdit && setIsEditingValue(true)}
                      disabled={!canInlineEdit}
                    >
                      <span className="text-3xl font-bold text-foreground">
                        {formatCurrency(propostaSource.valor)}
                      </span>
                      {canInlineEdit ? <Pencil className="h-4 w-4 text-muted-foreground" /> : null}
                    </button>
                  )}
                  {isEditingDescription ? (
                    <div className="space-y-3">
                      <Textarea
                        rows={6}
                        value={editingDescription}
                        onChange={(event) => setEditingDescription(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                            event.preventDefault()
                            void handleSaveDescription()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setIsEditingDescription(false)
                            setEditingDescription(propostaSource.descricao || '')
                          }
                        }}
                        placeholder="Descreva os detalhes desta proposta..."
                        autoFocus
                        className="min-h-[144px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsEditingDescription(false)
                            setEditingDescription(propostaSource.descricao || '')
                          }}
                          disabled={isSubmitting}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={() => void handleSaveDescription()} disabled={isSubmitting}>
                          Salvar descricao
                        </Button>
                      </div>
                    </div>
                  ) : propostaSource.descricao ? (
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => canInlineEdit && setIsEditingDescription(true)}
                      disabled={!canInlineEdit}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                        {propostaSource.descricao}
                      </p>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-left text-sm text-muted-foreground transition hover:bg-secondary/20"
                      onClick={() => canInlineEdit && setIsEditingDescription(true)}
                      disabled={!canInlineEdit}
                    >
                      <span>Nenhuma descricao adicional foi registrada.</span>
                      {canInlineEdit ? <Pencil className="h-4 w-4 shrink-0" /> : null}
                    </button>
                  )}
                </div>

                <div className="grid min-w-0 gap-4 md:grid-cols-2">
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

                <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
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

                <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    Anexos
                  </div>
                  {propostaSource.anexos?.length ? (
                    <div className="space-y-2">
                      {propostaSource.anexos.map((anexo) => (
                        <a
                          key={anexo.id}
                          href={buildAttachmentHref(anexo.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-secondary/30"
                        >
                          <span className="min-w-0 flex-1 break-words">{anexo.nome}</span>
                          <div className="ml-0 shrink-0 flex items-center gap-2">
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

            <div className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:h-[calc(100vh-9rem)] lg:min-h-0">
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
                <div className="min-w-0 space-y-4">
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
                                <div className="flex flex-wrap justify-end gap-2">
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

                <div className="min-w-0 space-y-3 px-4 py-4">
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
                      className="max-w-full whitespace-normal text-right"
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
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 break-words text-base font-semibold text-foreground">{value}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
