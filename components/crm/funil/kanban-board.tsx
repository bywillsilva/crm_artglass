'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, MessageSquare, Paperclip, Pencil } from 'lucide-react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
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

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getHoursUntil(target: Date, now: Date) {
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60)
}

export function KanbanBoard({ propostas }: KanbanBoardProps) {
  const { state, updateProposta } = useCRM()
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const [draggedPropostaId, setDraggedPropostaId] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [moveComment, setMoveComment] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)

  const propostasVisiveis = useMemo(() => {
    const source = propostas || state.propostas
    if (user?.role === 'admin' || user?.role === 'gerente') return source
    if (user?.role === 'orcamentista') {
      return source.filter(
        (proposta) =>
          proposta.orcamentistaId === user.id &&
          ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status)
      )
    }
    return source.filter((proposta) => proposta.responsavelId === user?.id)
  }, [propostas, state.propostas, user?.id, user?.role])

  const getProposalAutoTask = (propostaId: string, stage?: string) =>
    state.tarefas.find(
      (tarefa) =>
        tarefa.propostaId === propostaId &&
        tarefa.origem === 'automacao_proposta' &&
        tarefa.status !== 'concluida' &&
        (!stage || tarefa.automacaoEtapa === stage)
    )

  const getCardState = (proposta: Proposta) => {
    const now = new Date()
    const task = getProposalAutoTask(
      proposta.id,
      proposta.status === 'em_orcamento'
        ? 'em_orcamento'
        : proposta.status === 'em_retificacao'
          ? 'em_retificacao'
          : proposta.status === 'enviar_ao_cliente'
            ? 'enviar_ao_cliente'
            : proposta.status
    )

    if (!task) {
      return { classes: 'border-border bg-card', label: '' }
    }

    const dueDate = new Date(task.dataHora)
    if (proposta.status === 'em_orcamento') {
      const warningAt = new Date(dueDate)
      warningAt.setDate(warningAt.getDate() - 1)

      if (now >= dueDate) {
        return { classes: 'border-red-500 bg-red-500/10', label: 'Orcamento em atraso' }
      }

      if (now >= warningAt) {
        return { classes: 'border-orange-500 bg-orange-500/10', label: 'Prazo do orcamento apertado' }
      }
    }

    if (proposta.status === 'enviar_ao_cliente' && now > dueDate) {
      return { classes: 'border-red-500 bg-red-500/10', label: 'Envio ao cliente atrasado' }
    }

    if (['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(proposta.status)) {
      const hoursUntilDue = getHoursUntil(dueDate, now)

      if (now > dueDate) {
        return { classes: 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30', label: 'Follow-up atrasado' }
      }

      if (isSameDay(now, dueDate)) {
        return { classes: 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30', label: 'Follow-up no dia certo' }
      }

      if (hoursUntilDue <= 12) {
        return { classes: 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/25', label: 'Follow-up se aproximando' }
      }
    }

    return { classes: 'border-border bg-card', label: task ? `Prazo ${formatDateTime(task.dataHora)}` : '' }
  }

  const requestMove = (propostaId: string, targetStatus: StatusProposta) => {
    const proposta = propostasVisiveis.find((item) => item.id === propostaId)
    if (!proposta || proposta.status === targetStatus) {
      return
    }

    const currentTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
    setPendingMove({ propostaId, targetStatus })
    setMoveComment('')
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
    const proposta = propostasVisiveis.find((item) => item.id === pendingMove.propostaId)
    if (!proposta) return

    await updateProposta({
      ...proposta,
      status: pendingMove.targetStatus,
      comentario: moveComment,
      followUpTime: followUpTime || proposta.followUpTime || null,
    } as Proposta)

    setPendingMove(null)
    setMoveComment('')
    setFollowUpTime('')
  }

  const pendingMoveProposal = pendingMove
    ? propostasVisiveis.find((item) => item.id === pendingMove.propostaId)
    : null
  const requiresMoveComment =
    !!pendingMoveProposal &&
    user?.role === 'vendedor' &&
    ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(
      pendingMoveProposal?.status || 'novo_cliente'
    ) &&
    pendingMoveProposal?.status !== pendingMove?.targetStatus
  const requiresFollowUpTime =
    Boolean(pendingMoveProposal) &&
    user?.role === 'vendedor' &&
    ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(
      pendingMove?.targetStatus || 'novo_cliente'
    )
  const isSchedulingFollowUp = requiresFollowUpTime
  const pendingMoveTargetLabel = pendingMove ? statusPropostaLabels[pendingMove.targetStatus] : ''

  return (
    <>
      <div className="flex min-h-[calc(100vh-12rem)] gap-4 overflow-x-auto pb-4">
        {columns.map((status) => {
          const propostasDaColuna = propostasVisiveis.filter((proposta) => proposta.status === status)
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
                        onDragStart={() => setDraggedPropostaId(proposta.id)}
                        className={`rounded-xl border p-4 shadow-sm transition ${cardState.classes}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {state.clientes.find((cliente) => cliente.id === proposta.clienteId)?.nome || 'Cliente'}
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
