'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Clock3, MessageSquare, Paperclip, Pencil } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

type DragPointerType = 'mouse' | 'touch' | 'pen'

type PendingDrag = {
  pointerId: number
  pointerType: DragPointerType
  propostaId: string
  sourceStatus: StatusProposta
  startX: number
  startY: number
  currentX: number
  currentY: number
  offsetX: number
  offsetY: number
  width: number
  height: number
  element: HTMLDivElement
  ready: boolean
}

type DragState = Omit<PendingDrag, 'element' | 'ready'> & {
  overStatus: StatusProposta | null
  hasMoved: boolean
}

const TOUCH_DRAG_HOLD_MS = 220
const TOUCH_DRAG_CANCEL_DISTANCE = 14
const TOUCH_DRAG_START_DISTANCE = 14
const MOUSE_DRAG_START_DISTANCE = 6
const TOUCH_AUTO_SCROLL_EDGE_PX = 84
const TOUCH_AUTO_SCROLL_MAX_STEP = 26
const INTERACTIVE_DRAG_SELECTOR = 'button, a, input, textarea, select, [role="button"], [data-no-touch-drag]'

function isTouchLikePointer(event: React.PointerEvent) {
  return event.pointerType === 'touch' || event.pointerType === 'pen'
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_DRAG_SELECTOR))
}

interface KanbanBoardProps {
  propostas?: Proposta[]
}

export function KanbanBoard({ propostas }: KanbanBoardProps) {
  const { state, lookups, updateProposta } = useCRM()
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [moveComment, setMoveComment] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [moveValue, setMoveValue] = useState('')
  const [optimisticPropostas, setOptimisticPropostas] = useState<Record<string, Partial<Proposta>>>({})
  const [updatingProposalIds, setUpdatingProposalIds] = useState<Record<string, true>>({})
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)
  const [touchMovePropostaId, setTouchMovePropostaId] = useState<string | null>(null)
  const [touchMoveStatus, setTouchMoveStatus] = useState<StatusProposta | ''>('')
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [isSubmittingMove, setIsSubmittingMove] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const touchDragTimerRef = useRef<number | null>(null)
  const touchPendingDragRef = useRef<PendingDrag | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragStateFrameRef = useRef<number | null>(null)
  const dragStateUpdaterRef = useRef<((current: DragState | null) => DragState | null) | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(pointer: coarse), (hover: none)')
    const updateTouchState = () => {
      setIsTouchDevice(mediaQuery.matches || navigator.maxTouchPoints > 0)
    }

    updateTouchState()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateTouchState)
    } else {
      mediaQuery.addListener(updateTouchState)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', updateTouchState)
      } else {
        mediaQuery.removeListener(updateTouchState)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (touchDragTimerRef.current !== null) {
        window.clearTimeout(touchDragTimerRef.current)
      }
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
      }
      if (dragStateFrameRef.current !== null) {
        window.cancelAnimationFrame(dragStateFrameRef.current)
      }
    }
  }, [])

  const scheduleDragStateUpdate = useCallback((updater: (current: DragState | null) => DragState | null) => {
    dragStateUpdaterRef.current = updater
    if (dragStateFrameRef.current !== null) {
      return
    }

    dragStateFrameRef.current = window.requestAnimationFrame(() => {
      const nextUpdater = dragStateUpdaterRef.current
      dragStateFrameRef.current = null
      dragStateUpdaterRef.current = null

      if (!nextUpdater) {
        return
      }

      setDragState((current) => nextUpdater(current))
    })
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const previousUserSelect = document.body.style.userSelect
    const previousWebkitUserSelect = document.body.style.webkitUserSelect

    if (dragState) {
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
    }

    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.webkitUserSelect = previousWebkitUserSelect
    }
  }, [dragState])

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

  const columnSummaries = useMemo(
    () =>
      Object.fromEntries(
        columns.map((status) => [
          status,
          {
            propostas: propostasByStatus[status],
            valorTotal: propostasByStatus[status].reduce((acc, proposta) => acc + proposta.valor, 0),
          },
        ])
      ) as Record<StatusProposta, { propostas: Proposta[]; valorTotal: number }>,
    [propostasByStatus]
  )

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

  const clearTouchPendingDrag = (releasePointer = false) => {
    if (touchDragTimerRef.current !== null) {
      window.clearTimeout(touchDragTimerRef.current)
      touchDragTimerRef.current = null
    }

    const pending = touchPendingDragRef.current
    if (releasePointer && pending?.element.hasPointerCapture?.(pending.pointerId)) {
      pending.element.releasePointerCapture(pending.pointerId)
    }

    touchPendingDragRef.current = null
  }

  const getTouchDropStatus = (clientX: number, clientY: number) => {
    if (typeof document === 'undefined') return null

    const dropTarget = document
      .elementFromPoint(clientX, clientY)
      ?.closest('[data-kanban-column-status]')

    if (!(dropTarget instanceof HTMLElement)) {
      return null
    }

    const status = dropTarget.dataset.kanbanColumnStatus
    return columns.includes(status as StatusProposta) ? (status as StatusProposta) : null
  }

  const beginPointerDrag = (pending: PendingDrag, clientX: number, clientY: number) => {
    try {
      pending.element.setPointerCapture?.(pending.pointerId)
    } catch {
      // Ignora falhas de capture em navegadores mais limitados.
    }

    if (touchDragTimerRef.current !== null) {
      window.clearTimeout(touchDragTimerRef.current)
      touchDragTimerRef.current = null
    }

    touchPendingDragRef.current = pending
    dragPointRef.current = { x: clientX, y: clientY }
    setDragState({
      ...pending,
      currentX: clientX,
      currentY: clientY,
      overStatus: pending.pointerType === 'mouse' ? getTouchDropStatus(clientX, clientY) : null,
      hasMoved: false,
    })
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

  const openTouchMovePicker = (propostaId: string) => {
    setTouchMovePropostaId(propostaId)
    setTouchMoveStatus('')
  }

  const confirmTouchMoveSelection = () => {
    if (!touchMovePropostaId || !touchMoveStatus) return
    requestMove(touchMovePropostaId, touchMoveStatus)
    setTouchMovePropostaId(null)
    setTouchMoveStatus('')
  }

  const handleTouchPointerDown = (event: React.PointerEvent<HTMLDivElement>, proposta: Proposta) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || isInteractiveTarget(event.target)) {
      return
    }

    if (isTouchLikePointer(event)) {
      event.preventDefault()
    }

    const card = event.currentTarget
    const rect = card.getBoundingClientRect()
    const isTouchPointer = isTouchLikePointer(event)
    const pending: PendingDrag = {
      pointerId: event.pointerId,
      pointerType: (event.pointerType || 'mouse') as DragPointerType,
      propostaId: proposta.id,
      sourceStatus: proposta.status,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      element: card,
      ready: !isTouchPointer,
    }

    clearTouchPendingDrag()
    touchPendingDragRef.current = pending

    if (isTouchPointer) {
      touchDragTimerRef.current = window.setTimeout(() => {
        if (touchPendingDragRef.current?.pointerId !== pending.pointerId) {
          return
        }

        const readyPending = {
          ...pending,
          ready: true,
        }
        touchPendingDragRef.current = readyPending
        touchDragTimerRef.current = null
        beginPointerDrag(readyPending, readyPending.currentX, readyPending.currentY)
      }, TOUCH_DRAG_HOLD_MS)
    }
  }

  const handleTouchPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pending = touchPendingDragRef.current
    if (pending?.pointerId === event.pointerId && !dragState) {
      const deltaX = event.clientX - pending.startX
      const deltaY = event.clientY - pending.startY
      const distance = Math.hypot(deltaX, deltaY)

      if (pending.pointerType !== 'mouse' && !pending.ready && distance > TOUCH_DRAG_CANCEL_DISTANCE) {
        clearTouchPendingDrag()
        return
      }

      const startDistance =
        pending.pointerType === 'mouse' ? MOUSE_DRAG_START_DISTANCE : TOUCH_DRAG_START_DISTANCE

      if (pending.pointerType === 'mouse' && pending.ready && distance >= startDistance) {
        event.preventDefault()
        beginPointerDrag(pending, event.clientX, event.clientY)
        return
      }

      pending.currentX = event.clientX
      pending.currentY = event.clientY
      dragPointRef.current = { x: event.clientX, y: event.clientY }
      return
    }

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    dragPointRef.current = { x: event.clientX, y: event.clientY }
    const overStatus = getTouchDropStatus(event.clientX, event.clientY)
    const dragDistance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY)
    scheduleDragStateUpdate((current) =>
      current && current.pointerId === event.pointerId
        ? {
            ...current,
            currentX: event.clientX,
            currentY: event.clientY,
            overStatus,
            hasMoved:
              current.hasMoved ||
              dragDistance >=
                (current.pointerType === 'mouse' ? MOUSE_DRAG_START_DISTANCE : TOUCH_DRAG_START_DISTANCE),
          }
        : current
    )
  }

  const finishTouchDrag = (pointerId: number) => {
    const activeTouchDrag = dragState
    const pending = touchPendingDragRef.current
    const captureElement = pending?.element

    if (pending?.pointerId === pointerId) {
      clearTouchPendingDrag(true)
    }

    if (!activeTouchDrag || activeTouchDrag.pointerId !== pointerId) {
      return
    }

    if (
      activeTouchDrag.hasMoved &&
      activeTouchDrag.overStatus &&
      activeTouchDrag.overStatus !== activeTouchDrag.sourceStatus
    ) {
      requestMove(activeTouchDrag.propostaId, activeTouchDrag.overStatus)
    }

    if (captureElement?.hasPointerCapture?.(pointerId)) {
      captureElement.releasePointerCapture(pointerId)
    }

    dragPointRef.current = null
    if (dragStateFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStateFrameRef.current)
      dragStateFrameRef.current = null
      dragStateUpdaterRef.current = null
    }
    setDragState(null)
  }

  const handleTouchPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    finishTouchDrag(event.pointerId)
  }

  const confirmMove = async () => {
    if (!pendingMove || isSubmittingMove) return
    const proposta = propostasById.get(pendingMove.propostaId)
    if (!proposta) return
    const currentPendingMove = pendingMove
    const persistedStatus = resolveProposalStatusForPersistence(proposta.status, pendingMove.targetStatus)
    const nextValue = pendingMove.targetStatus === 'aguardando_aprovacao' ? Number(moveValue || 0) : proposta.valor
    const optimisticPatch: Partial<Proposta> = {
      status: persistedStatus,
      valor: nextValue,
      followUpTime: followUpTime || proposta.followUpTime || null,
    }

    setIsSubmittingMove(true)
    setOptimisticPropostas((prev) => ({ ...prev, [proposta.id]: optimisticPatch }))
    setUpdatingProposalIds((prev) => ({ ...prev, [proposta.id]: true }))

    try {
      await updateProposta({
        ...proposta,
        status: currentPendingMove.targetStatus,
        valor: nextValue,
        comentario: moveComment,
        followUpTime: followUpTime || proposta.followUpTime || null,
      } as Proposta)
      toast.success('Proposta atualizada com sucesso.')
      setPendingMove(null)
      setMoveComment('')
      setFollowUpTime('')
      setMoveValue('')
    } catch (error: any) {
      setOptimisticPropostas((prev) => {
        const next = { ...prev }
        delete next[proposta.id]
        return next
      })
      toast.error(error?.message || 'Nao foi possivel atualizar a proposta.')
    } finally {
      setIsSubmittingMove(false)
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
  const touchMoveProposal = touchMovePropostaId ? propostasById.get(touchMovePropostaId) || null : null
  const availableTouchStatuses = touchMoveProposal
    ? columns.filter((status) => status !== touchMoveProposal.status)
    : []
  const draggedTouchProposal = dragState ? propostasById.get(dragState.propostaId) || null : null
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0

  useEffect(() => {
    if (!dragState || dragState.pointerType === 'mouse' || typeof window === 'undefined') {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      return
    }

    const tick = () => {
      const container = scrollContainerRef.current
      const dragPoint = dragPointRef.current

      if (!container || !dragPoint) {
        autoScrollFrameRef.current = window.requestAnimationFrame(tick)
        return
      }

      const rect = container.getBoundingClientRect()
      let deltaX = 0

      if (dragPoint.x >= rect.right - TOUCH_AUTO_SCROLL_EDGE_PX) {
        const intensity = Math.min(
          1,
          (dragPoint.x - (rect.right - TOUCH_AUTO_SCROLL_EDGE_PX)) / TOUCH_AUTO_SCROLL_EDGE_PX
        )
        deltaX = Math.ceil(TOUCH_AUTO_SCROLL_MAX_STEP * Math.max(0.2, intensity))
      } else if (dragPoint.x <= rect.left + TOUCH_AUTO_SCROLL_EDGE_PX) {
        const intensity = Math.min(
          1,
          ((rect.left + TOUCH_AUTO_SCROLL_EDGE_PX) - dragPoint.x) / TOUCH_AUTO_SCROLL_EDGE_PX
        )
        deltaX = -Math.ceil(TOUCH_AUTO_SCROLL_MAX_STEP * Math.max(0.2, intensity))
      }

      if (deltaX !== 0) {
        const previousScrollLeft = container.scrollLeft
        container.scrollLeft += deltaX

        if (container.scrollLeft !== previousScrollLeft) {
          const overStatus = getTouchDropStatus(dragPoint.x, dragPoint.y)
          scheduleDragStateUpdate((current) =>
            current
              ? {
                  ...current,
                  overStatus,
                }
              : current
          )
        }
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tick)
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
    }
  }, [dragState, scheduleDragStateUpdate])

  return (
    <>
      <div
        ref={scrollContainerRef}
        className={`flex min-h-[calc(100vh-12rem)] gap-4 overflow-x-auto pb-4 ${dragState ? 'touch-none' : ''}`}
      >
        {columns.map((status) => {
          const propostasDaColuna = columnSummaries[status].propostas
          const valorTotal = columnSummaries[status].valorTotal
          const isTouchDropTarget = dragState?.overStatus === status

          return (
            <div
              key={status}
              data-kanban-column-status={status}
              className={`flex w-80 min-w-80 flex-col rounded-lg border-t-4 bg-card transition-colors ${
                columnBorderColors[status]
              } ${isTouchDropTarget ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''}`}
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
                        aria-busy={Boolean(updatingProposalIds[proposta.id])}
                        onPointerDown={(event) => handleTouchPointerDown(event, proposta)}
                        onPointerMove={handleTouchPointerMove}
                        onPointerUp={handleTouchPointerEnd}
                        onPointerCancel={handleTouchPointerEnd}
                        onContextMenu={(event) => event.preventDefault()}
                        className={`rounded-xl border p-4 shadow-sm transition ${cardState.classes} ${
                          updatingProposalIds[proposta.id] ? 'opacity-70' : ''
                        } ${
                          dragState?.propostaId === proposta.id
                            ? 'opacity-35 scale-[0.98]'
                            : ''
                        } select-none [-webkit-touch-callout:none]`}
                        style={{ touchAction: isTouchDevice ? 'none' : undefined }}
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
                            {isTouchDevice ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openTouchMovePicker(proposta.id)}
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                            ) : null}
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

      {dragState && draggedTouchProposal ? (
        <div
          className="pointer-events-none fixed z-[70] w-80 max-w-[calc(100vw-2rem)]"
          style={{
            left: Math.max(
              16,
              Math.min(dragState.currentX - dragState.offsetX, viewportWidth - dragState.width - 16)
            ),
            top: Math.max(
              16,
              Math.min(dragState.currentY - dragState.offsetY, viewportHeight - dragState.height - 16)
            ),
          }}
        >
          <div className="rounded-xl border border-primary/40 bg-card/95 p-4 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {lookups.clientesById.get(draggedTouchProposal.clienteId)?.nome || 'Cliente'}
                </p>
                <p className="mt-1 text-lg font-bold text-foreground">
                  {formatCurrency(draggedTouchProposal.valor)}
                </p>
              </div>
              <ArrowRightLeft className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Solte o card na coluna desejada para mover a proposta.
            </p>
          </div>
        </div>
      ) : null}

      <Dialog
        open={Boolean(touchMovePropostaId)}
        onOpenChange={(open) => {
          if (!open) {
            setTouchMovePropostaId(null)
            setTouchMoveStatus('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escolher nova etapa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione a coluna para onde esta proposta deve ser movida.
            </p>
            <Select
              value={touchMoveStatus}
              onValueChange={(value) => setTouchMoveStatus(value as StatusProposta)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                {availableTouchStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusPropostaLabels[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setTouchMovePropostaId(null)
                  setTouchMoveStatus('')
                }}
              >
                Cancelar
              </Button>
              <Button onClick={confirmTouchMoveSelection} disabled={!touchMoveStatus}>
                Continuar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              <Button variant="outline" onClick={() => setPendingMove(null)} disabled={isSubmittingMove}>
                Cancelar
              </Button>
              <Button
                onClick={() => void confirmMove()}
                pending={isSubmittingMove}
                disabled={
                  isSubmittingMove ||
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
