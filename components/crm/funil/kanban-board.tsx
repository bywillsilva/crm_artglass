'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, MessageSquare, Paperclip, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import {
  getProposalCardVisualState,
  getProposalTaskStage,
  requiresFollowUpTimeForMove,
  requiresSellerCommentForMove,
  resolveProposalStatusForPersistence,
} from '@/lib/utils/proposal-kanban'
import { ProposalFormDialog } from '@/components/crm/propostas/proposal-form-dialog'
import { ProposalDetailsSheet } from '@/components/crm/propostas/proposal-details-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'

const columns: StatusProposta[] = [
  'novo_cliente',
  'em_orcamento',
  'em_retificacao',
  'aguardando_aprovacao',
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'follow_up_3_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'perdido',
]

const columnBorderColors: Record<StatusProposta, string> = {
  novo_cliente: 'border-sky-500',
  em_orcamento: 'border-slate-500',
  em_retificacao: 'border-purple-500',
  aguardando_aprovacao: 'border-violet-500',
  enviar_ao_cliente: 'border-blue-500',
  enviado_ao_cliente: 'border-blue-500',
  follow_up_1_dia: 'border-emerald-500',
  follow_up_3_dias: 'border-emerald-500',
  follow_up_7_dias: 'border-emerald-500',
  stand_by: 'border-zinc-500',
  fechado: 'border-emerald-600',
  perdido: 'border-red-500',
  aguardando_follow_up_3_dias: 'border-amber-500',
  aguardando_follow_up_7_dias: 'border-amber-500',
}

type PendingMove = {
  propostaId: string
  targetStatus: StatusProposta
}

interface KanbanBoardProps {
  propostas?: Proposta[]
}

export function KanbanBoard({ propostas }: KanbanBoardProps) {
  const { state, lookups, updateProposta } = useCRM()
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const [draggedPropostaId, setDraggedPropostaId] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [moveComment, setMoveComment] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [moveValue, setMoveValue] = useState('')
  const [optimisticPropostas, setOptimisticPropostas] = useState<Record<string, Partial<Proposta>>>({})
  const [updatingProposalIds, setUpdatingProposalIds] = useState<Record<string, true>>({})
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)

  const propostasBase = useMemo(
    () =>
      (propostas || state.propostas).map((proposta) =>
        optimisticPropostas[proposta.id]
          ? { ...proposta, ...optimisticPropostas[proposta.id] }
          : proposta
      ),
    [optimisticPropostas, propostas, state.propostas]
  )

  const propostasVisiveis = useMemo(() => {
    const source = propostasBase
    if (user?.role === 'admin' || user?.role === 'gerente') return source
    if (user?.role === 'orcamentista') {
      return source.filter(
        (proposta) =>
          (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
          ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
      )
    }
    return source.filter((proposta) => proposta.responsavelId === user?.id)
  }, [propostasBase, user?.id, user?.role])

  const propostasById = useMemo(
    () => new Map(propostasVisiveis.map((proposta) => [proposta.id, proposta])),
    [propostasVisiveis]
  )

  const propostasByStatus = useMemo(() => {
    const grouped = Object.fromEntries(columns.map((status) => [status, [] as Proposta[]])) as Record<
      StatusProposta,
      Proposta[]
    >

    for (const proposta of propostasVisiveis) {
      if (proposta.status in grouped) {
        grouped[proposta.status].push(proposta)
      }
    }

    return grouped
  }, [propostasVisiveis])

  const automatedTasksByProposalStage = useMemo(() => {
    const taskMap = new Map<string, (typeof state.tarefas)[number]>()

    for (const tarefa of state.tarefas) {
      if (
        !tarefa.propostaId ||
        tarefa.origem !== 'automacao_proposta' ||
        tarefa.status === 'concluida'
      ) {
        continue
      }

      const key = `${tarefa.propostaId}:${tarefa.automacaoEtapa || ''}`
      if (!taskMap.has(key)) {
        taskMap.set(key, tarefa)
      }
    }

    return taskMap
  }, [state.tarefas])

  const getProposalAutoTask = (propostaId: string, stage?: string) =>
    automatedTasksByProposalStage.get(`${propostaId}:${stage || ''}`)

  const getCardState = (proposta: Proposta) => {
    const task = getProposalAutoTask(proposta.id, getProposalTaskStage(proposta.status))
    return getProposalCardVisualState(proposta.status, task, formatDateTime)
  }

  const requestMove = (propostaId: string, targetStatus: StatusProposta) => {
    const proposta = propostasById.get(propostaId)
    if (!proposta || proposta.status === targetStatus) {
      return
    }

    const currentTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
    setPendingMove({ propostaId, targetStatus })
    setMoveComment('')
    setMoveValue(targetStatus === 'aguardando_aprovacao' && proposta.valor > 0 ? String(proposta.valor) : '')
    setFollowUpTime(
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(targetStatus)
        ? (proposta.followUpTime || currentTime).slice(0, 5)
        : (proposta.followUpTime || '').slice(0, 5)
    )
  }

  const handleDrop = (targetStatus: StatusProposta) => {
    if (!draggedPropostaId) return
    requestMove(draggedPropostaId, targetStatus)
    setDraggedPropostaId(null)
  }

  const confirmMove = async () => {
    if (!pendingMove) return
    const proposta = propostasById.get(pendingMove.propostaId)
    if (!proposta) return
    const persistedStatus = resolveProposalStatusForPersistence(proposta.status, pendingMove.targetStatus)
    const nextValue = pendingMove.targetStatus === 'aguardando_aprovacao' ? Number(moveValue || 0) : proposta.valor
    const optimisticPatch: Partial<Proposta> = {
      status: persistedStatus,
      valor: nextValue,
      followUpTime: followUpTime || proposta.followUpTime || null,
    }

    setOptimisticPropostas((prev) => ({ ...prev, [proposta.id]: optimisticPatch }))
    setUpdatingProposalIds((prev) => ({ ...prev, [proposta.id]: true }))
    setPendingMove(null)
    setMoveComment('')
    setFollowUpTime('')
    setMoveValue('')

    try {
      await updateProposta({
        ...proposta,
        status: pendingMove.targetStatus,
        valor: nextValue,
        comentario: moveComment,
        followUpTime: followUpTime || proposta.followUpTime || null,
      } as Proposta)
    } catch (error: any) {
      setOptimisticPropostas((prev) => {
        const next = { ...prev }
        delete next[proposta.id]
        return next
      })
      toast.error(error?.message || 'Nao foi possivel atualizar a proposta.')
    } finally {
      setUpdatingProposalIds((prev) => {
        const next = { ...prev }
        delete next[proposta.id]
        return next
      })
      setOptimisticPropostas((prev) => {
        const next = { ...prev }
        delete next[proposta.id]
        return next
      })
    }
  }

  const pendingMoveProposal = pendingMove
    ? propostasById.get(pendingMove.propostaId) || null
    : null
  const requiresMoveComment = requiresSellerCommentForMove(
    user?.role,
    pendingMoveProposal?.status,
    pendingMove?.targetStatus
  )
  const requiresFollowUpTime = requiresFollowUpTimeForMove(user?.role, pendingMove?.targetStatus)
  const requiresBudgetValue = pendingMove?.targetStatus === 'aguardando_aprovacao'
  const isSchedulingFollowUp = requiresFollowUpTime
  const pendingMoveTargetLabel = pendingMove ? statusPropostaLabels[pendingMove.targetStatus] : ''

  return (
    <>
      <div className="flex min-h-[calc(100vh-12rem)] gap-4 overflow-x-auto pb-4">
        {columns.map((status) => {
          const propostasDaColuna = propostasByStatus[status]
          const valorTotal = propostasDaColuna.reduce((acc, proposta) => acc + proposta.valor, 0)

          return (
            <div
              key={status}
              className={`flex w-80 min-w-80 flex-col rounded-lg border-t-4 bg-card ${columnBorderColors[status]}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(status)}
            >
              <div className="border-b border-border p-4">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-foreground">{statusPropostaLabels[status]}</h3>
                  <span className="rounded bg-secondary px-2 py-0.5 text-sm text-muted-foreground">
                    {propostasDaColuna.length}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{formatCurrency(valorTotal)}</p>
              </div>

              <div className="flex-1 space-y-3 p-3">
                {propostasDaColuna.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    Nenhuma proposta nesta etapa
                  </div>
                ) : (
                  propostasDaColuna.map((proposta) => {
                    const cardState = getCardState(proposta)
                    return (
                      <div
                        key={proposta.id}
                        draggable
                        aria-busy={Boolean(updatingProposalIds[proposta.id])}
                        onDragStart={() => setDraggedPropostaId(proposta.id)}
                        className={`rounded-xl border p-4 shadow-sm transition ${cardState.classes} ${
                          updatingProposalIds[proposta.id] ? 'opacity-70' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {lookups.clientesById.get(proposta.clienteId)?.nome || 'Cliente'}
                            </p>
                            <p className="mt-1 text-lg font-bold text-foreground">
                              {formatCurrency(proposta.valor)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setDetailsPropostaId(proposta.id)}>
                              Ver detalhes
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingPropostaId(proposta.id)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {proposta.descricao ? (
                          <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{proposta.descricao}</p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Vend.: {proposta.responsavelNome || '-'}</span>
                          <span>Orc.: {proposta.orcamentistaNome || '-'}</span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Paperclip className="h-3 w-3" />
                            {proposta.anexosCount ?? proposta.anexos?.length ?? 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {proposta.comentariosCount ?? proposta.comentarios?.length ?? 0}
                          </span>
                        </div>

                        {cardState.label ? (
                          <div className="mt-3 flex items-center gap-2 rounded-lg bg-background/60 px-3 py-2 text-xs text-foreground">
                            {cardState.classes.includes('emerald') ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            ) : cardState.classes.includes('orange') || cardState.classes.includes('red') ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            ) : (
                              <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {cardState.label}
                          </div>
                        ) : null}

                        {status === 'aguardando_aprovacao' && (user?.role === 'admin' || user?.role === 'gerente') ? (
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={() => requestMove(proposta.id, 'enviar_ao_cliente')}>
                              Aprovar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => requestMove(proposta.id, 'em_retificacao')}>
                              Recusar
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={Boolean(pendingMove)} onOpenChange={(open) => !open && setPendingMove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isSchedulingFollowUp ? `Agendar ${pendingMoveTargetLabel}` : 'Atualizar etapa da proposta'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {requiresFollowUpTime && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  Escolha o horario do contato com o cliente nesta etapa.
                </p>
                <p className="text-sm text-muted-foreground">
                  A tarefa automatica sera criada nesse horario para o follow-up selecionado.
                </p>
                <div className="max-w-xs space-y-2">
                  <label className="text-sm font-medium text-foreground">Horario do follow-up</label>
                  <Input
                    type="time"
                    value={followUpTime}
                    onChange={(event) => setFollowUpTime(event.target.value)}
                  />
                </div>
              </div>
            )}
            {requiresBudgetValue && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  Informe o valor do orçamento antes de enviar a proposta para aguardando aprovação.
                </p>
                <div className="max-w-xs space-y-2">
                  <label className="text-sm font-medium text-foreground">Valor do orçamento</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={moveValue}
                    onChange={(event) => setMoveValue(event.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>
            )}
            {requiresMoveComment && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm text-muted-foreground">
                  Este follow-up exige um comentario do vendedor antes da movimentacao.
                </p>
                <Textarea
                  rows={4}
                  placeholder="Escreva um comentario sobre o andamento da proposta..."
                  value={moveComment}
                  onChange={(event) => setMoveComment(event.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingMove(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void confirmMove()}
                disabled={
                  (requiresBudgetValue && Number(moveValue || 0) <= 0) ||
                  (requiresMoveComment && !moveComment.trim()) ||
                  (requiresFollowUpTime && !followUpTime)
                }
              >
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProposalFormDialog
        open={Boolean(editingPropostaId)}
        onOpenChange={(open) => !open && setEditingPropostaId(null)}
        propostaId={editingPropostaId}
      />
      <ProposalDetailsSheet
        open={Boolean(detailsPropostaId)}
        onOpenChange={(open) => !open && setDetailsPropostaId(null)}
        propostaId={detailsPropostaId}
      />
    </>
  )
}
