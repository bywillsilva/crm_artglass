'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  MessageSquare,
  Paperclip,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useProposta, useSession } from '@/lib/hooks/use-api'
import { formatBrazilPhone } from '@/lib/utils/phone'
import {
  getProposalCardVisualState,
  getProposalTaskStage,
} from '@/lib/utils/proposal-kanban'
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

type SellerMoveAction =
  | 'enviado_ao_cliente'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'
  | 'stand_by'
  | 'outra_justificativa'

const ORCAMENTISTA_COLUMNS: StatusProposta[] = [
  'novo_cliente',
  'em_orcamento',
  'em_retificacao',
  'aguardando_aprovacao',
]

const SELLER_COLUMNS: StatusProposta[] = [
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'follow_up_3_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'perdido',
]

function resolveKanbanDisplayStatus(status: StatusProposta): StatusProposta {
  if (status === 'aguardando_follow_up_3_dias') return 'follow_up_3_dias'
  if (status === 'aguardando_follow_up_7_dias') return 'follow_up_7_dias'
  return status
}

const SELLER_ACTION_LABELS: Record<SellerMoveAction, string> = {
  enviado_ao_cliente: 'Enviado ao cliente',
  em_retificacao: 'Enviar para retificacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
  stand_by: 'Stand-by',
  outra_justificativa: 'Outra justificativa',
}

function getAdminCommercialStatusOptions(status: StatusProposta, role?: string | null): StatusProposta[] {
  switch (status) {
    case 'enviar_ao_cliente':
      return role === 'admin'
        ? ['enviado_ao_cliente', 'aguardando_aprovacao', 'em_retificacao', 'em_orcamento']
        : ['enviado_ao_cliente']
    case 'enviado_ao_cliente':
      return ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao']
    case 'follow_up_1_dia':
      return ['follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'follow_up_3_dias':
      return ['follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'follow_up_7_dias':
      return ['fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'stand_by':
      return ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido']
    default:
      return []
  }
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

function getSellerActionOptions(status: StatusProposta): SellerMoveAction[] {
  switch (status) {
    case 'enviar_ao_cliente':
      return ['enviado_ao_cliente']
    case 'enviado_ao_cliente':
      return ['fechado', 'perdido', 'em_retificacao', 'outra_justificativa']
    case 'follow_up_1_dia':
    case 'aguardando_follow_up_3_dias':
    case 'follow_up_3_dias':
      return ['fechado', 'perdido', 'em_retificacao', 'stand_by', 'outra_justificativa']
    case 'aguardando_follow_up_7_dias':
    case 'follow_up_7_dias':
      return ['fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'stand_by':
      return ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido']
    default:
      return []
  }
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isPdfAttachment(anexo: {
  tipoMime?: string
  tipo_mime?: string
  nome?: string
  nome_original?: string
}) {
  return (
    anexo.tipoMime === 'application/pdf' ||
    anexo.tipo_mime === 'application/pdf' ||
    String(anexo.nome || anexo.nome_original || '').toLowerCase().endsWith('.pdf')
  )
}

function proposalHasApprovalRequirements(
  proposta:
    | Proposta
    | (Partial<Proposta> & {
        anexos?: Array<{
          tipoMime?: string
          tipo_mime?: string
          nome?: string
          nome_original?: string
        }>
      })
) {
  const hasPositiveValue = Number(proposta.valor || 0) > 0
  const hasPdfAttachment = Array.isArray(proposta.anexos) && proposta.anexos.some(isPdfAttachment)
  return hasPositiveValue && hasPdfAttachment
}

function parseProposalNumericInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function getDeadlineBannerStyles(cardStateClasses: string) {
  if (cardStateClasses.includes('red')) {
    return {
      container: 'bg-red-500/15 text-red-200 border-red-500/30',
      icon: 'text-red-400',
    }
  }

  if (cardStateClasses.includes('orange') || cardStateClasses.includes('amber')) {
    return {
      container: 'bg-amber-500/15 text-amber-100 border-amber-500/30',
      icon: 'text-amber-400',
    }
  }

  if (cardStateClasses.includes('emerald')) {
    return {
      container: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/30',
      icon: 'text-emerald-400',
    }
  }

  return {
    container: 'bg-background/80 text-foreground border-border',
    icon: 'text-muted-foreground',
  }
}

export function KanbanBoard({ propostas }: KanbanBoardProps) {
  const { state, lookups, updateProposta } = useCRM()
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [sellerAction, setSellerAction] = useState<SellerMoveAction | ''>('')
  const [adminMoveStatus, setAdminMoveStatus] = useState<StatusProposta | ''>('')
  const [moveComment, setMoveComment] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [moveValue, setMoveValue] = useState('')
  const [moveFiles, setMoveFiles] = useState<File[]>([])
  const [closeClientName, setCloseClientName] = useState('')
  const [closeClientCpf, setCloseClientCpf] = useState('')
  const [closeClientEmail, setCloseClientEmail] = useState('')
  const [closeClientPhone, setCloseClientPhone] = useState('')
  const [closeClientAddress, setCloseClientAddress] = useState('')
  const [optimisticPropostas, setOptimisticPropostas] = useState<Record<string, Partial<Proposta>>>({})
  const [updatingProposalIds, setUpdatingProposalIds] = useState<Record<string, true>>({})
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
          ORCAMENTISTA_COLUMNS.includes(proposta.status)
      )
    }
    return source.filter(
      (proposta) =>
        proposta.responsavelId === user?.id &&
        SELLER_COLUMNS.includes(resolveKanbanDisplayStatus(proposta.status))
    )
  }, [propostasBase, user?.id, user?.role])

  const visibleColumns = useMemo(() => {
    if (user?.role === 'admin' || user?.role === 'gerente') return columns
    if (user?.role === 'orcamentista') return ORCAMENTISTA_COLUMNS
    return SELLER_COLUMNS
  }, [user?.role])

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
      const displayStatus = resolveKanbanDisplayStatus(proposta.status)
      if (displayStatus in grouped) {
        grouped[displayStatus].push(proposta)
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
        tarefa.status === 'concluida'
      ) {
        continue
      }

      if (tarefa.origem !== 'automacao_proposta' && !tarefa.automacaoEtapa) {
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
    return getProposalCardVisualState(resolveKanbanDisplayStatus(proposta.status), task, formatDateTime)
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

  const shouldRequireMoveComment = useCallback(
    (
      proposta: Proposta,
      targetStatus: StatusProposta,
      sellerWorkflowAction?: SellerMoveAction | ''
    ) => {
      if (sellerWorkflowAction === 'em_retificacao') return true
      if (sellerWorkflowAction === 'outra_justificativa') return true
      if (sellerWorkflowAction === 'perdido') return true
      if (sellerWorkflowAction === 'stand_by') return true

      if (!sellerWorkflowAction && ['em_retificacao', 'perdido', 'stand_by'].includes(targetStatus)) {
        const isAdminApprovalRefusal =
          ['admin', 'gerente'].includes(user?.role || '') &&
          proposta.status === 'aguardando_aprovacao' &&
          targetStatus === 'em_retificacao'

        return !isAdminApprovalRefusal
      }

      return false
    },
    [user?.role]
  )

  const requestMove = async (propostaId: string, targetStatus: StatusProposta) => {
    const proposta = propostasById.get(propostaId)
    const isCommercialCard = proposta ? SELLER_COLUMNS.includes(resolveKanbanDisplayStatus(proposta.status)) : false
    const canOpenSameStatusGuidedAction =
      proposta?.status === targetStatus &&
      isCommercialCard &&
      ['vendedor', 'admin', 'gerente'].includes(user?.role || '')

    if (!proposta || (proposta.status === targetStatus && !canOpenSameStatusGuidedAction)) {
      return
    }

    const cliente = lookups.clientesById.get(proposta.clienteId)
    const currentTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
    const requiresDirectFollowUpTime = ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(targetStatus)
    const requiresApprovalValidationRole = ['orcamentista', 'admin', 'gerente'].includes(user?.role || '')
    const requiresDirectApprovalValidation =
      requiresApprovalValidationRole && targetStatus === 'aguardando_aprovacao'
    const requiresDirectMoveComment = shouldRequireMoveComment(proposta, targetStatus)
    const requiresDirectClosedClientData = targetStatus === 'fechado'
    const requiresGuidedCommercialAction =
      (user?.role === 'vendedor' && isCommercialCard) ||
      ((user?.role === 'admin' || user?.role === 'gerente') &&
        isCommercialCard &&
        targetStatus === proposta.status)

    if (requiresDirectApprovalValidation) {
      const loadedProposalAlreadyReady = proposalHasApprovalRequirements(proposta)

      if (loadedProposalAlreadyReady) {
        void executeMove(proposta, { targetStatus })
        return
      }

      try {
        const response = await fetch(`/api/propostas/${proposta.id}`)
        if (response.ok) {
          const detailedProposal = (await response.json()) as Proposta
          if (proposalHasApprovalRequirements(detailedProposal)) {
            void executeMove(proposta, { targetStatus })
            return
          }
        }
      } catch {
        // Se a validacao detalhada falhar, seguimos para o modal guiado.
      }
    }

    if (
      !requiresDirectFollowUpTime &&
      !requiresDirectApprovalValidation &&
      !requiresDirectMoveComment &&
      !requiresDirectClosedClientData &&
      !requiresGuidedCommercialAction
    ) {
      void executeMove(proposta, { targetStatus })
      return
    }

    setPendingMove({ propostaId, targetStatus })
    setSellerAction(
      user?.role === 'vendedor' && proposta.status === 'enviar_ao_cliente' && targetStatus === proposta.status
        ? 'enviado_ao_cliente'
        : ''
    )
    setAdminMoveStatus('')
    setMoveComment('')
    setMoveValue(proposta.valor > 0 ? String(proposta.valor) : '')
    setMoveFiles([])
    setFollowUpTime(
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(targetStatus)
        ? (proposta.followUpTime || currentTime).slice(0, 5)
        : (proposta.followUpTime || '').slice(0, 5)
    )
    setCloseClientName(cliente?.nome || proposta.clienteNome || '')
    setCloseClientCpf(cliente?.cpf || '')
    setCloseClientEmail(cliente?.email || '')
    setCloseClientPhone(cliente?.telefone || '')
    setCloseClientAddress(cliente?.endereco || '')
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
    if (user?.role === 'vendedor') {
      return
    }

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

  const executeMove = useCallback(
    async (
      proposta: Proposta,
      options: {
        targetStatus: StatusProposta
        sellerWorkflowAction?: SellerMoveAction | ''
        adminStatus?: StatusProposta | ''
        comment?: string
        followUpTime?: string
        moveValue?: string
        moveFiles?: File[]
        closeClientData?: {
          nome: string
          cpf: string
          email: string
          telefone: string
          endereco: string
        }
      }
    ) => {
      if (isSubmittingMove) return

      const effectiveSellerWorkflowAction = options.sellerWorkflowAction || ''
      const baseTargetStatus = options.adminStatus || options.targetStatus
      const resolvedStatus = (() => {
        if (effectiveSellerWorkflowAction) {
          if (effectiveSellerWorkflowAction === 'outra_justificativa') {
            if (proposta.status === 'enviado_ao_cliente') return 'follow_up_1_dia' as StatusProposta
            if (proposta.status === 'follow_up_1_dia') return 'follow_up_3_dias' as StatusProposta
            if (proposta.status === 'follow_up_3_dias') return 'follow_up_7_dias' as StatusProposta
          }

          return effectiveSellerWorkflowAction as StatusProposta
        }

        return baseTargetStatus as StatusProposta
      })()

      const persistedStatus =
        proposta.status === 'follow_up_1_dia' && resolvedStatus === 'follow_up_3_dias'
          ? ('aguardando_follow_up_3_dias' as StatusProposta)
          : proposta.status === 'follow_up_3_dias' && resolvedStatus === 'follow_up_7_dias'
            ? ('aguardando_follow_up_7_dias' as StatusProposta)
            : resolvedStatus

      const parsedSubmittedValue = parseProposalNumericInput(options.moveValue || '')
      const shouldUseSubmittedValue =
        persistedStatus === 'fechado' ||
        (persistedStatus === 'aguardando_aprovacao' && (parsedSubmittedValue ?? 0) > 0)
      const nextValue = shouldUseSubmittedValue ? (parsedSubmittedValue ?? 0) : proposta.valor
      const optimisticPatch: Partial<Proposta> = {
        status: persistedStatus,
        valor: nextValue,
        followUpTime: options.followUpTime || proposta.followUpTime || null,
      }

      setIsSubmittingMove(true)
      setOptimisticPropostas((prev) => ({ ...prev, [proposta.id]: optimisticPatch }))
      setUpdatingProposalIds((prev) => ({ ...prev, [proposta.id]: true }))

      try {
        await updateProposta({
          ...proposta,
          status: effectiveSellerWorkflowAction ? proposta.status : resolvedStatus,
          valor: nextValue,
          comentario: options.comment || null,
          justificativa: options.comment || null,
          workflowAction: effectiveSellerWorkflowAction || null,
          followUpTime: options.followUpTime || proposta.followUpTime || null,
          clienteNome: persistedStatus === 'fechado' ? options.closeClientData?.nome || null : null,
          clienteCpf: persistedStatus === 'fechado' ? options.closeClientData?.cpf || null : null,
          clienteEmail: persistedStatus === 'fechado' ? options.closeClientData?.email || null : null,
          clienteTelefone: persistedStatus === 'fechado' ? options.closeClientData?.telefone || null : null,
          clienteEndereco: persistedStatus === 'fechado' ? options.closeClientData?.endereco || null : null,
          clienteValorFechado: persistedStatus === 'fechado' ? nextValue : null,
          anexos: options.moveFiles || [],
        } as unknown as Proposta)
        toast.success('Proposta atualizada com sucesso.')
        setPendingMove(null)
        setSellerAction('')
        setAdminMoveStatus('')
        setMoveComment('')
        setFollowUpTime('')
        setMoveValue('')
        setMoveFiles([])
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
    },
    [isSubmittingMove, updateProposta]
  )

  const confirmMove = async () => {
    if (!pendingMove || isSubmittingMove) return
    const proposta = propostasById.get(pendingMove.propostaId)
    if (!proposta) return

    await executeMove(proposta, {
      targetStatus: pendingMove.targetStatus,
      sellerWorkflowAction: isSellerMove ? effectiveSellerAction : '',
      adminStatus: isAdminCommercialMove ? adminMoveStatus : '',
      comment: requiresMoveComment ? moveComment : '',
      followUpTime: followUpTime || proposta.followUpTime || undefined,
      moveValue,
      moveFiles,
      closeClientData: requiresClosedClientData
        ? {
            nome: closeClientName,
            cpf: closeClientCpf,
            email: closeClientEmail,
            telefone: closeClientPhone,
            endereco: closeClientAddress,
          }
        : undefined,
    })
  }

  const pendingMoveProposal = pendingMove
    ? propostasById.get(pendingMove.propostaId) || null
    : null
  const pendingMoveDisplayStatus = pendingMoveProposal
    ? resolveKanbanDisplayStatus(pendingMoveProposal.status)
    : null
  const isSellerMove = user?.role === 'vendedor' && Boolean(pendingMoveProposal)
  const isAdminCommercialMove =
    Boolean(pendingMoveProposal) &&
    (user?.role === 'admin' || user?.role === 'gerente') &&
    Boolean(pendingMoveDisplayStatus && SELLER_COLUMNS.includes(pendingMoveDisplayStatus)) &&
    pendingMove?.targetStatus === pendingMoveProposal?.status
  const sellerActionOptions = pendingMoveProposal ? getSellerActionOptions(pendingMoveProposal.status) : []
  const adminCommercialOptions = pendingMoveProposal
    ? getAdminCommercialStatusOptions(pendingMoveDisplayStatus || pendingMoveProposal.status, user?.role)
    : []
  const selectedSellerAction = isSellerMove ? sellerAction : ''
  const sellerCanOnlyConfirmSend = isSellerMove && pendingMoveProposal?.status === 'enviar_ao_cliente'
  const effectiveSellerAction =
    sellerCanOnlyConfirmSend && isSellerMove
      ? ('enviado_ao_cliente' as SellerMoveAction)
      : (selectedSellerAction as SellerMoveAction | '')
  const shouldShowSellerActionSelect = isSellerMove && !sellerCanOnlyConfirmSend
  const resolvedAdminMoveStatus = isAdminCommercialMove ? adminMoveStatus : pendingMove?.targetStatus || ''
  const resolvedTargetStatus = (() => {
    if (isSellerMove && effectiveSellerAction && pendingMoveProposal) {
      if (effectiveSellerAction === 'outra_justificativa') {
        if (pendingMoveProposal.status === 'enviado_ao_cliente') return 'follow_up_1_dia' as StatusProposta
        if (pendingMoveProposal.status === 'follow_up_1_dia') return 'follow_up_3_dias' as StatusProposta
        if (pendingMoveProposal.status === 'follow_up_3_dias') return 'follow_up_7_dias' as StatusProposta
      }

      return effectiveSellerAction as StatusProposta
    }

    return resolvedAdminMoveStatus as StatusProposta
  })()
  const approvalValidationProposalId =
    pendingMove &&
    ['orcamentista', 'admin', 'gerente'].includes(user?.role || '') &&
    resolvedTargetStatus === 'aguardando_aprovacao'
      ? pendingMove.propostaId
      : null
  const {
    proposta: approvalValidationProposalData,
    isLoading: isLoadingApprovalValidationProposal,
  } = useProposta(approvalValidationProposalId)
  const requiresMoveComment = pendingMoveProposal
    ? shouldRequireMoveComment(
        pendingMoveProposal,
        (resolvedTargetStatus || pendingMove?.targetStatus || pendingMoveProposal.status) as StatusProposta,
        effectiveSellerAction
      )
    : false
  const requiresFollowUpTime =
    (effectiveSellerAction === 'outra_justificativa' &&
      ['enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias'].includes(
        pendingMoveProposal?.status || ''
      )) ||
    (!isSellerMove &&
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(resolvedTargetStatus || ''))
  const approvalValidationActive =
    ['orcamentista', 'admin', 'gerente'].includes(user?.role || '') &&
    resolvedTargetStatus === 'aguardando_aprovacao'
  const approvalTargetProposal = approvalValidationProposalData || pendingMoveProposal
  const hasExistingProposalPdf = approvalTargetProposal
    ? Array.isArray(approvalTargetProposal.anexos)
      ? approvalTargetProposal.anexos.some(isPdfAttachment)
      : false
    : false
  const parsedMoveValue = parseProposalNumericInput(moveValue)
  const existingApprovalValue =
    approvalTargetProposal?.valor && approvalTargetProposal.valor > 0 ? approvalTargetProposal.valor : 0
  const proposalNeedsApprovalValue = approvalValidationActive && existingApprovalValue <= 0
  const requiresBudgetValue = proposalNeedsApprovalValue
  const requiresAttachment = approvalValidationActive && !hasExistingProposalPdf
  const hasRequiredPdfAttachment = !requiresAttachment || moveFiles.some(isPdfFile)
  const approvalRequirementsReady = !approvalValidationActive || !isLoadingApprovalValidationProposal
  const approvalRequirementsMessage = approvalValidationActive
    ? proposalNeedsApprovalValue && requiresAttachment
      ? 'Para enviar esta proposta para aprovacao, informe o valor do orcamento e anexe a proposta em PDF.'
      : proposalNeedsApprovalValue
        ? 'Para enviar esta proposta para aprovacao, informe o valor do orcamento.'
        : requiresAttachment
          ? 'Para enviar esta proposta para aprovacao, anexe a proposta em PDF.'
          : 'Esta proposta ja tem os dados obrigatorios para seguir para aprovacao.'
    : null
  const requiresClosedClientData =
    effectiveSellerAction === 'fechado' || (!isSellerMove && resolvedTargetStatus === 'fechado')
  const hasInvalidMoveValue = moveValue.trim() !== '' && parsedMoveValue === null
  const isSchedulingFollowUp = requiresFollowUpTime
  const pendingMoveTargetLabel = pendingMove ? statusPropostaLabels[pendingMove.targetStatus] : ''
  const touchMoveProposal = touchMovePropostaId ? propostasById.get(touchMovePropostaId) || null : null
  const availableTouchStatuses = touchMoveProposal
    ? visibleColumns.filter((status) => status !== touchMoveProposal.status)
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
        {visibleColumns.map((status) => {
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
                        style={{ touchAction: isTouchDevice && user?.role !== 'vendedor' ? 'none' : undefined }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {lookups.clientesById.get(proposta.clienteId)?.nome || proposta.clienteNome || 'Cliente'}
                            </p>
                            <p className="mt-1 text-lg font-bold text-foreground">
                              {formatCurrency(proposta.valor)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-1 py-1">
                            {isTouchDevice && user?.role !== 'vendedor' ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full text-muted-foreground hover:text-foreground"
                                title="Mover card"
                                aria-label="Mover card"
                                onClick={() => openTouchMovePicker(proposta.id)}
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-full text-muted-foreground hover:text-foreground"
                              title="Ver detalhes"
                              aria-label="Ver detalhes"
                              onClick={() => setDetailsPropostaId(proposta.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {user?.role === 'vendedor' && proposta.status === 'enviar_ao_cliente' ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full text-emerald-500 hover:text-emerald-400"
                                title="Confirmar envio ao cliente"
                                aria-label="Confirmar envio ao cliente"
                                onClick={() => requestMove(proposta.id, proposta.status)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {user?.role === 'vendedor' &&
                            proposta.status !== 'enviar_ao_cliente' &&
                            getSellerActionOptions(proposta.status).length > 0 ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full text-amber-500 hover:text-amber-400"
                                title="Atualizar status"
                                aria-label="Atualizar status"
                                onClick={() => requestMove(proposta.id, proposta.status)}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {(user?.role === 'admin' || user?.role === 'gerente') &&
                            SELLER_COLUMNS.includes(resolveKanbanDisplayStatus(proposta.status)) ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full text-amber-500 hover:text-amber-400"
                                title="Atualizar status"
                                aria-label="Atualizar status"
                                onClick={() => requestMove(proposta.id, proposta.status)}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            ) : null}
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
                            {proposta.anexos?.length ?? proposta.anexosCount ?? 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {proposta.comentarios?.length ?? proposta.comentariosCount ?? 0}
                          </span>
                        </div>

                        {cardState.label ? (() => {
                          const bannerStyles = getDeadlineBannerStyles(cardState.classes)
                          return (
                            <div
                              className={`mt-4 -mx-4 flex items-center gap-2 border-y px-4 py-2 text-xs font-medium ${bannerStyles.container}`}
                            >
                              {cardState.classes.includes('emerald') ? (
                                <CheckCircle2 className={`h-3.5 w-3.5 ${bannerStyles.icon}`} />
                              ) : cardState.classes.includes('orange') ||
                                cardState.classes.includes('amber') ||
                                cardState.classes.includes('red') ? (
                                <AlertTriangle className={`h-3.5 w-3.5 ${bannerStyles.icon}`} />
                              ) : (
                                <Clock3 className={`h-3.5 w-3.5 ${bannerStyles.icon}`} />
                              )}
                              <span>{cardState.label}</span>
                            </div>
                          )
                        })() : null}

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
                    {lookups.clientesById.get(draggedTouchProposal.clienteId)?.nome || draggedTouchProposal.clienteNome || 'Cliente'}
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

      <Dialog
        open={Boolean(pendingMove)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingMove(null)
            setSellerAction('')
            setAdminMoveStatus('')
            setMoveComment('')
            setFollowUpTime('')
            setMoveValue('')
            setMoveFiles([])
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sellerCanOnlyConfirmSend
                ? 'Confirmar envio ao cliente'
                : isSellerMove || isAdminCommercialMove
                ? 'Atualizar status da proposta'
                : isSchedulingFollowUp
                  ? `Agendar ${pendingMoveTargetLabel}`
                  : 'Atualizar etapa da proposta'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(isSellerMove || isAdminCommercialMove) && pendingMoveProposal ? (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                {shouldShowSellerActionSelect ? (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      Escolha como esta proposta deve seguir nesta etapa.
                    </p>
                    <Select value={sellerAction} onValueChange={(value) => setSellerAction(value as SellerMoveAction)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione a atualizacao" />
                      </SelectTrigger>
                      <SelectContent>
                        {sellerActionOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {SELLER_ACTION_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : isAdminCommercialMove ? (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      Escolha o novo status desta proposta nesta etapa comercial.
                    </p>
                    <Select
                      value={adminMoveStatus}
                      onValueChange={(value) => setAdminMoveStatus(value as StatusProposta)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o novo status" />
                      </SelectTrigger>
                      <SelectContent>
                        {adminCommercialOptions.map((statusOption) => (
                          <SelectItem key={statusOption} value={statusOption}>
                            {statusPropostaLabels[statusOption]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      Confirmar envio da proposta para o cliente.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Ao confirmar, o card sera movido para Enviado ao cliente e o fluxo seguira normalmente.
                    </p>
                  </>
                )}
              </div>
            ) : null}
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
            {approvalValidationActive ? (
              <div className="space-y-2 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  {isLoadingApprovalValidationProposal
                    ? 'Validando os requisitos desta proposta para envio a aprovacao...'
                    : approvalRequirementsMessage}
                </p>
              </div>
            ) : null}
            {requiresBudgetValue && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  Informe o valor do orçamento antes de enviar a proposta para aguardando aprovação.
                </p>
                <div className="max-w-xs space-y-2">
                  <label className="text-sm font-medium text-foreground">Valor do orçamento</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={moveValue}
                    onChange={(event) => setMoveValue(event.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>
            )}
            {requiresAttachment && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao quando esta proposta ainda nao tiver anexo.
                </p>
                <Input
                  type="file"
                  multiple
                  accept=".pdf,application/pdf"
                  onChange={(event) => setMoveFiles(Array.from(event.target.files || []))}
                />
                {moveFiles.length > 0 ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {moveFiles.map((file) => (
                      <p key={`${file.name}-${file.size}`}>{file.name}</p>
                    ))}
                  </div>
                ) : null}
                {!hasRequiredPdfAttachment ? (
                  <p className="text-sm text-destructive">Selecione pelo menos um arquivo PDF valido.</p>
                ) : null}
              </div>
            )}
            {requiresMoveComment && (
              <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm text-muted-foreground">
                  Informe uma justificativa para registrar no historico desta proposta antes da movimentacao.
                </p>
                <Textarea
                  rows={4}
                  placeholder="Escreva um comentario sobre o andamento da proposta..."
                  value={moveComment}
                  onChange={(event) => setMoveComment(event.target.value)}
                />
              </div>
            )}
            {requiresClosedClientData && (
              <div className="space-y-4 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium text-foreground">
                  Complete os dados do cliente para seguir com o fechamento e o contrato.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Nome completo</label>
                    <Input value={closeClientName} onChange={(event) => setCloseClientName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">CPF</label>
                    <Input
                      value={closeClientCpf}
                      placeholder="000.000.000-00"
                      onChange={(event) => setCloseClientCpf(event.target.value)}
                      onBlur={(event) => setCloseClientCpf(formatCpf(event.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Telefone</label>
                    <Input
                      value={closeClientPhone}
                      placeholder="(00) 9 0000-0000"
                      onChange={(event) => setCloseClientPhone(event.target.value)}
                      onBlur={(event) => setCloseClientPhone(formatBrazilPhone(event.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">E-mail</label>
                    <Input
                      type="email"
                      value={closeClientEmail}
                      onChange={(event) => setCloseClientEmail(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-foreground">Endereco</label>
                    <Input
                      value={closeClientAddress}
                      onChange={(event) => setCloseClientAddress(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Valor fechado</label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={moveValue}
                      onChange={(event) => setMoveValue(event.target.value)}
                      placeholder="0,00"
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingMove(null)} disabled={isSubmittingMove}>
                Cancelar
              </Button>
              <Button
                data-enter-confirm="true"
                onClick={() => void confirmMove()}
                pending={isSubmittingMove}
                disabled={
                  isSubmittingMove ||
                    !approvalRequirementsReady ||
                    (isSellerMove && !effectiveSellerAction) ||
                    (isAdminCommercialMove && !resolvedTargetStatus) ||
                    hasInvalidMoveValue ||
                    (proposalNeedsApprovalValue && (parseProposalNumericInput(moveValue) ?? 0) <= 0) ||
                    !hasRequiredPdfAttachment ||
                    (requiresMoveComment && !moveComment.trim()) ||
                    (requiresFollowUpTime && !followUpTime) ||
                    (requiresClosedClientData &&
                      (!closeClientName.trim() ||
                        !closeClientCpf.trim() ||
                        !closeClientPhone.trim() ||
                        !closeClientEmail.trim() ||
                        !closeClientAddress.trim() ||
                        (parseProposalNumericInput(moveValue) ?? 0) <= 0))
                }
              >
                {sellerCanOnlyConfirmSend ? 'Confirmar envio' : 'Confirmar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProposalDetailsSheet
        open={Boolean(detailsPropostaId)}
        onOpenChange={(open) => !open && setDetailsPropostaId(null)}
        propostaId={detailsPropostaId}
        propostaInicial={detailsPropostaId ? propostasById.get(detailsPropostaId) || null : null}
      />
    </>
  )
}
