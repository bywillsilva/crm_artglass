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
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { prefetchProposta, useProposta, useSession } from '@/lib/hooks/use-api'
import { formatCep, useCepLookup } from '@/lib/hooks/use-cep-lookup'
import { formatBrazilPhone } from '@/lib/utils/phone'
import {
  formatClientDocument,
  getClientDocumentLabel,
  getClientDocumentPlaceholder,
  getClientDocumentValidationMessage,
  inferClientType,
  isValidClientDocument,
} from '@/lib/utils/client-document'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
import {
  getProposalCardVisualState,
  getProposalTaskStage,
} from '@/lib/utils/proposal-kanban'
import { getCurrentPostClosingLabel } from '@/lib/utils/post-closing'
import { ProposalDetailsSheet } from '@/components/crm/propostas/proposal-details-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { statusPropostaLabels, type Proposta, type StatusProposta, type TipoCliente } from '@/lib/data/types'

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
  'pos_fechamento',
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
  pos_fechamento: 'border-cyan-500',
  perdido: 'border-red-500',
  aguardando_follow_up_3_dias: 'border-amber-500',
  aguardando_follow_up_7_dias: 'border-amber-500',
}

type PendingMove = {
  propostaId: string
  targetStatus: StatusProposta
  targetIndex?: number | null
}

type PendingMoveDialogSnapshot = {
  pendingMove: PendingMove
  sellerAction: SellerMoveAction | ''
  adminMoveStatus: StatusProposta | ''
  moveComment: string
  followUpTime: string
  moveValue: string
  moveFiles: File[]
  closeClientData: {
    tipo: TipoCliente
    nome: string
    cpf: string
    email: string
    telefone: string
    endereco: string
    numero: string
    bairro: string
    cidade: string
    estado: string
    cep: string
  }
}

type SellerMoveAction =
  | 'enviado_ao_cliente'
  | 'follow_up_1_dia'
  | 'follow_up_3_dias'
  | 'follow_up_7_dias'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'
  | 'stand_by'

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
  'pos_fechamento',
  'perdido',
]

function resolveKanbanDisplayStatus(status: StatusProposta): StatusProposta {
  if (status === 'aguardando_follow_up_3_dias') return 'follow_up_3_dias'
  if (status === 'aguardando_follow_up_7_dias') return 'follow_up_7_dias'
  return status
}

const SELLER_ACTION_LABELS: Record<SellerMoveAction, string> = {
  enviado_ao_cliente: 'Enviado ao cliente',
  follow_up_1_dia: statusPropostaLabels.follow_up_1_dia,
  follow_up_3_dias: statusPropostaLabels.follow_up_3_dias,
  follow_up_7_dias: statusPropostaLabels.follow_up_7_dias,
  em_retificacao: 'Enviar para retificacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
  stand_by: 'Stand-by',
}

function getSellerActionDialogCopy(action: SellerMoveAction | '') {
  switch (action) {
    case 'enviado_ao_cliente':
      return {
        title: 'Confirmar envio ao cliente',
        heading: 'Confirmar envio da proposta para o cliente.',
        description:
          'Ao confirmar, o card sera movido para Enviado ao cliente e o fluxo seguira normalmente.',
      }
    case 'fechado':
      return {
        title: 'Fechar proposta',
        heading: 'Confirmar fechamento da proposta.',
        description:
          'Ao confirmar, o card sera movido para Fechado e o sistema registrara os dados finais do cliente e do valor de fechamento.',
      }
    case 'perdido':
      return {
        title: 'Marcar proposta como perdida',
        heading: 'Confirmar perda da proposta.',
        description:
          'Ao confirmar, o card sera movido para Perdido e a justificativa sera registrada nos comentarios.',
      }
    case 'em_retificacao':
      return {
        title: 'Enviar proposta para retificacao',
        heading: 'Confirmar envio para retificacao.',
        description:
          'Ao confirmar, o card sera movido para Em retificacao e a justificativa sera registrada nos comentarios.',
      }
    case 'stand_by':
      return {
        title: 'Colocar proposta em stand-by',
        heading: 'Confirmar envio para stand-by.',
        description:
          'Ao confirmar, o card sera movido para Stand-by e a justificativa sera registrada nos comentarios.',
      }
    case 'follow_up_1_dia':
    case 'follow_up_3_dias':
    case 'follow_up_7_dias':
      return {
        title: 'Atualizar status da proposta',
        heading: `Confirmar envio para ${SELLER_ACTION_LABELS[action]}.`,
        description:
          'Ao confirmar, o card sera movido para a etapa selecionada e o proximo horario de follow-up sera considerado.',
      }
    default:
      return {
        title: 'Atualizar status da proposta',
        heading: 'Atualizar status da proposta.',
        description: 'Confirme a movimentacao desta proposta para continuar o fluxo.',
      }
  }
}

function formatFollowUpTimeForSubmission(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getAdminCommercialStatusOptions(
  status: StatusProposta,
  role?: string | null,
  canMoveToPostClosing = false
): StatusProposta[] {
  if (role === 'admin') {
    return columns.filter((item) => item !== status)
  }

  switch (status) {
    case 'enviar_ao_cliente':
      return role === 'admin'
        ? ['enviado_ao_cliente', 'aguardando_aprovacao', 'em_retificacao', 'em_orcamento']
        : ['enviado_ao_cliente']
    case 'enviado_ao_cliente':
      return ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao']
    case 'follow_up_1_dia':
      return ['follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'follow_up_3_dias':
      return ['follow_up_1_dia', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'follow_up_7_dias':
      return ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'stand_by':
      return ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido']
    case 'fechado':
      return canMoveToPostClosing ? ['pos_fechamento', 'em_retificacao'] : ['em_retificacao']
    case 'pos_fechamento':
      return ['fechado', 'enviado_ao_cliente', 'em_retificacao', 'perdido']
    case 'perdido':
      return ['em_retificacao']
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
  overIndex: number | null
  hasMoved: boolean
}

const TOUCH_DRAG_HOLD_MS = 320
const TOUCH_DRAG_CANCEL_DISTANCE = 18
const TOUCH_DRAG_START_DISTANCE = 14
const MOUSE_DRAG_START_DISTANCE = 6
const TOUCH_AUTO_SCROLL_EDGE_PX = 84
const TOUCH_AUTO_SCROLL_MAX_STEP = 26
const TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX = 96
const TOUCH_AUTO_SCROLL_VERTICAL_MAX_STEP = 18
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

type ProposalDropTarget = {
  status: StatusProposta | null
  index: number | null
}

function dedupePropostasById(propostas: Proposta[]) {
  const byId = new Map<string, Proposta>()

  for (const proposta of propostas) {
    const id = String(proposta.id || '')
    if (!id) {
      continue
    }

    const current = byId.get(id)
    if (!current) {
      byId.set(id, proposta)
      continue
    }

    const currentUpdatedAt = (current as unknown as Record<string, unknown>).updatedAt
    const nextUpdatedAt = (proposta as unknown as Record<string, unknown>).updatedAt
    const currentTime = currentUpdatedAt ? new Date(String(currentUpdatedAt)).getTime() : 0
    const nextTime = nextUpdatedAt ? new Date(String(nextUpdatedAt)).getTime() : 0

    if (nextTime >= currentTime) {
      byId.set(id, { ...current, ...proposta })
    }
  }

  return [...byId.values()]
}

function shouldReplaceTask(currentTask: { dataHora: Date }, nextTask: { dataHora: Date }) {
  return nextTask.dataHora.getTime() < currentTask.dataHora.getTime()
}

function compareProposalKanbanOrder(a: Proposta, b: Proposta) {
  const orderA = typeof a.kanbanOrder === 'number' && Number.isFinite(a.kanbanOrder) ? a.kanbanOrder : null
  const orderB = typeof b.kanbanOrder === 'number' && Number.isFinite(b.kanbanOrder) ? b.kanbanOrder : null

  if (orderA != null && orderB != null && orderA !== orderB) {
    return orderA - orderB
  }

  if (orderA != null) return -1
  if (orderB != null) return 1

  return b.criadoEm.getTime() - a.criadoEm.getTime()
}

function getProposalCardTitle(proposta: Proposta, clientName: string) {
  if (clientName) {
    return clientName
  }

  const rawTitle = (proposta.titulo || '').trim()
  return rawTitle || 'Proposta Comercial'
}

function ProposalMaterialTagList({ value }: { value?: string | null }) {
  const tags = parseProposalMaterialTags(value)

  if (!tags.length) {
    return null
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

function getSellerActionOptions(status: StatusProposta): SellerMoveAction[] {
  switch (status) {
    case 'enviar_ao_cliente':
      return ['enviado_ao_cliente']
    case 'enviado_ao_cliente':
      return ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao']
    case 'follow_up_1_dia':
      return ['follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'aguardando_follow_up_3_dias':
    case 'follow_up_3_dias':
      return ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'aguardando_follow_up_7_dias':
    case 'follow_up_7_dias':
      return ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by']
    case 'stand_by':
      return ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido']
    case 'fechado':
      return ['em_retificacao']
    case 'pos_fechamento':
      return []
    case 'perdido':
      return ['em_retificacao']
    default:
      return []
  }
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
        area_m2?: number | string | null
        perfis_bruto?: number | string | null
        perfis_liquidos?: number | string | null
        valor_vidro?: number | string | null
        valor_acessorios?: number | string | null
        orcamentista_id?: string | null
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

function readPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }

    if (typeof value === 'string') {
      const parsed = parseProposalNumericInput(value)
      if (parsed != null && parsed > 0) {
        return parsed
      }
    }
  }

  return 0
}

function hasApprovalTechnicalData(proposta: Partial<Proposta> & Record<string, unknown>) {
  return [
    readPositiveNumber(proposta.areaM2, proposta.area_m2),
    readPositiveNumber(proposta.perfisBruto, proposta.perfis_bruto),
    readPositiveNumber(proposta.perfisLiquidos, proposta.perfis_liquidos),
    readPositiveNumber(proposta.valorVidro, proposta.valor_vidro),
    readPositiveNumber(proposta.valorAcessorios, proposta.valor_acessorios),
  ].some((value) => value > 0)
}

function getProposalOrcamentistaId(proposta: Partial<Proposta> & Record<string, unknown>) {
  return String(proposta.orcamentistaId || proposta.orcamentista_id || '').trim()
}

function isProposalReadyForApproval(
  proposta: Partial<Proposta> & Record<string, unknown>,
  params: {
    requirePdf: boolean
    requireTechnicalData: boolean
    requireOrcamentista: boolean
    fallbackOrcamentistaId?: string | null
  }
) {
  return (
    readPositiveNumber(proposta.valor, proposta.valor_final) > 0 &&
    (!params.requirePdf || (Array.isArray(proposta.anexos) && proposta.anexos.some(isPdfAttachment))) &&
    (!params.requireTechnicalData || hasApprovalTechnicalData(proposta)) &&
    (!params.requireOrcamentista || Boolean(getProposalOrcamentistaId(proposta) || params.fallbackOrcamentistaId))
  )
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
  const [closeClientTipo, setCloseClientTipo] = useState<TipoCliente>('residencial')
  const [closeClientName, setCloseClientName] = useState('')
  const [closeClientCpf, setCloseClientCpf] = useState('')
  const [closeClientEmail, setCloseClientEmail] = useState('')
  const [closeClientPhone, setCloseClientPhone] = useState('')
  const [closeClientAddress, setCloseClientAddress] = useState('')
  const [closeClientNumber, setCloseClientNumber] = useState('')
  const [closeClientDistrict, setCloseClientDistrict] = useState('')
  const [closeClientCity, setCloseClientCity] = useState('')
  const [closeClientState, setCloseClientState] = useState('')
  const [closeClientCep, setCloseClientCep] = useState('')
  const { isLookingUpCep, cepLookupError, lookupCep, setCepLookupError } = useCepLookup()
  const [optimisticPropostas, setOptimisticPropostas] = useState<Record<string, Partial<Proposta>>>({})
  const [updatingProposalIds, setUpdatingProposalIds] = useState<Record<string, true>>({})
  const [detailsPropostaId, setDetailsPropostaId] = useState<string | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [isSubmittingMove, setIsSubmittingMove] = useState(false)
  const isSubmittingMoveRef = useRef(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const columnScrollRefs = useRef<Partial<Record<StatusProposta, HTMLDivElement | null>>>({})
  const floatingDragCardRef = useRef<HTMLDivElement | null>(null)
  const touchDragTimerRef = useRef<number | null>(null)
  const touchPendingDragRef = useRef<PendingDrag | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragVisualRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const dragDropTargetRef = useRef<ProposalDropTarget>({ status: null, index: null })
  const dragHasMovedRef = useRef(false)
  const canViewPostClosingColumn = hasRuleAccess(user, 'canViewPostClosing')
  const canMoveToPostClosing = hasRuleAccess(user, 'canMoveProposalToPostClosing')

  const resetPendingMoveDialog = useCallback(() => {
    setPendingMove(null)
    setSellerAction('')
    setAdminMoveStatus('')
    setMoveComment('')
    setFollowUpTime('')
    setMoveValue('')
    setMoveFiles([])
    setCloseClientTipo('residencial')
    setCloseClientName('')
    setCloseClientCpf('')
    setCloseClientEmail('')
    setCloseClientPhone('')
    setCloseClientAddress('')
    setCloseClientNumber('')
    setCloseClientDistrict('')
    setCloseClientCity('')
    setCloseClientState('')
    setCloseClientCep('')
  }, [])

  const restorePendingMoveDialog = useCallback((snapshot: PendingMoveDialogSnapshot) => {
    setPendingMove(snapshot.pendingMove)
    setSellerAction(snapshot.sellerAction)
    setAdminMoveStatus(snapshot.adminMoveStatus)
    setMoveComment(snapshot.moveComment)
    setFollowUpTime(snapshot.followUpTime)
    setMoveValue(snapshot.moveValue)
    setMoveFiles(snapshot.moveFiles)
    setCloseClientTipo(snapshot.closeClientData.tipo)
    setCloseClientName(snapshot.closeClientData.nome)
    setCloseClientCpf(snapshot.closeClientData.cpf)
    setCloseClientEmail(snapshot.closeClientData.email)
    setCloseClientPhone(snapshot.closeClientData.telefone)
    setCloseClientAddress(snapshot.closeClientData.endereco)
    setCloseClientNumber(snapshot.closeClientData.numero)
    setCloseClientDistrict(snapshot.closeClientData.bairro)
    setCloseClientCity(snapshot.closeClientData.cidade)
    setCloseClientState(snapshot.closeClientData.estado)
    setCloseClientCep(snapshot.closeClientData.cep)
  }, [])

  const updateFloatingDragPosition = useCallback(() => {
    const element = floatingDragCardRef.current
    const dragVisual = dragVisualRef.current
    if (!element || !dragVisual) {
      return
    }

    element.style.transform = `translate3d(${dragVisual.x - dragVisual.offsetX}px, ${dragVisual.y - dragVisual.offsetY}px, 0)`
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let mediaQuery: MediaQueryList | null = null
    try {
      mediaQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse), (hover: none)')
        : null
    } catch {
      mediaQuery = null
    }

    const updateTouchState = () => {
      const hasCoarsePointer = mediaQuery?.matches ?? false
      const hasTouchPoints = (() => {
        try {
          return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
        } catch {
          return false
        }
      })()
      setIsTouchDevice(hasCoarsePointer || hasTouchPoints)
    }

    updateTouchState()
    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateTouchState)
    } else if (mediaQuery) {
      mediaQuery.addListener(updateTouchState)
    }

    return () => {
      if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', updateTouchState)
      } else if (mediaQuery) {
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
    }
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

  useEffect(() => {
    if (typeof window === 'undefined' || !dragState) {
      return
    }

    const updateDragFromTouch = (touch: Touch) => {
      updateActivePointerDrag(touch, dragState)
    }

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()

       const touch = event.touches[0] || event.changedTouches[0]
       if (touch) {
         updateDragFromTouch(touch)
       }
    }

    window.addEventListener('touchmove', preventTouchScroll, { passive: false })

    return () => {
      window.removeEventListener('touchmove', preventTouchScroll)
    }
  }, [dragState, updateFloatingDragPosition])

  const propostasBase = useMemo(
    () =>
      dedupePropostasById((propostas || state.propostas).map((proposta) =>
        optimisticPropostas[proposta.id]
          ? { ...proposta, ...optimisticPropostas[proposta.id] }
          : proposta
      )),
    [optimisticPropostas, propostas, state.propostas]
  )

  useEffect(() => {
    const sourcePropostas = propostas || state.propostas

    setOptimisticPropostas((current) => {
      const entries = Object.entries(current)
      if (entries.length === 0) {
        return current
      }

      const sourceById = new Map(sourcePropostas.map((proposta) => [proposta.id, proposta] as const))
      let changed = false
      const next = { ...current }

      for (const [proposalId, patch] of entries) {
        const source = sourceById.get(proposalId)
        if (!source) {
          continue
        }

        const patchEntries = Object.entries(patch).filter(([, value]) => value !== undefined)
        const sourceRecord = source as unknown as Record<string, unknown>
        const patchAlreadyReflected = patchEntries.every(([key, value]) => {
          return Object.is(sourceRecord[key], value)
        })

        if (patchAlreadyReflected) {
          delete next[proposalId]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [propostas, state.propostas])

  const propostasVisiveis = useMemo(() => {
    const source = propostasBase
    const sourceWithPostClosingRule = canViewPostClosingColumn
      ? source
      : source.filter((proposta) => resolveKanbanDisplayStatus(proposta.status) !== 'pos_fechamento')

    if (user?.role === 'admin' || user?.role === 'gerente') return sourceWithPostClosingRule
    if (user?.role === 'orcamentista') {
      return sourceWithPostClosingRule.filter(
        (proposta) =>
          (!proposta.orcamentistaId || proposta.orcamentistaId === user.id) &&
          ORCAMENTISTA_COLUMNS.includes(proposta.status)
      )
    }
    return sourceWithPostClosingRule.filter(
      (proposta) =>
        proposta.responsavelId === user?.id &&
        SELLER_COLUMNS.includes(resolveKanbanDisplayStatus(proposta.status))
    )
  }, [canViewPostClosingColumn, propostasBase, user?.id, user?.role])

  const visibleColumns = useMemo(() => {
    const filterPostClosing = (items: StatusProposta[]) =>
      canViewPostClosingColumn ? items : items.filter((status) => status !== 'pos_fechamento')

    if (user?.role === 'admin' || user?.role === 'gerente') return filterPostClosing(columns)
    if (user?.role === 'orcamentista') return ORCAMENTISTA_COLUMNS
    return filterPostClosing(SELLER_COLUMNS)
  }, [canViewPostClosingColumn, user?.role])

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

    for (const status of columns) {
      grouped[status] = [...grouped[status]].sort(compareProposalKanbanOrder)
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
      if (!taskMap.has(key) || shouldReplaceTask(taskMap.get(key)!, tarefa)) {
        taskMap.set(key, tarefa)
      }
    }

    return taskMap
  }, [state.tarefas])

  const getProposalAutoTask = (propostaId: string, stage?: string) =>
    automatedTasksByProposalStage.get(`${propostaId}:${stage || ''}`) ||
    automatedTasksByProposalStage.get(`${propostaId}:`)

  const getCardState = (proposta: Proposta) => {
    const taskStage = getProposalTaskStage(proposta.status)
    const task = getProposalAutoTask(proposta.id, taskStage)
    return getProposalCardVisualState(resolveKanbanDisplayStatus(taskStage as StatusProposta), task, formatDateTime)
  }

  const clearTouchPendingDrag = (releasePointer = false) => {
    if (touchDragTimerRef.current !== null) {
      window.clearTimeout(touchDragTimerRef.current)
      touchDragTimerRef.current = null
    }

    const pending = touchPendingDragRef.current
    if (releasePointer && pending) {
      try {
        if (pending.element.hasPointerCapture?.(pending.pointerId)) {
          pending.element.releasePointerCapture(pending.pointerId)
        }
      } catch {
        // Ignora falhas de release em navegadores touch mais limitados.
      }
    }

    touchPendingDragRef.current = null
  }

  const getTouchDropTarget = (clientX: number, clientY: number, propostaId?: string): ProposalDropTarget => {
    if (typeof document === 'undefined') return { status: null, index: null }

    const dropTarget = document
      .elementFromPoint(clientX, clientY)
      ?.closest('[data-kanban-column-status]')

    if (!(dropTarget instanceof HTMLElement)) {
      return { status: null, index: null }
    }

    const status = dropTarget.dataset.kanbanColumnStatus
    if (!columns.includes(status as StatusProposta)) {
      return { status: null, index: null }
    }

    const normalizedStatus = status as StatusProposta
    const cards = Array.from(dropTarget.querySelectorAll<HTMLElement>('[data-kanban-card-id]')).filter(
      (card) => card.dataset.kanbanCardId !== propostaId
    )

    let index = cards.length

    for (let currentIndex = 0; currentIndex < cards.length; currentIndex += 1) {
      const cardRect = cards[currentIndex].getBoundingClientRect()
      const midpoint = cardRect.top + cardRect.height / 2
      if (clientY < midpoint) {
        index = currentIndex
        break
      }
    }

    return { status: normalizedStatus, index }
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
    dragVisualRef.current = {
      x: clientX,
      y: clientY,
      offsetX: pending.offsetX,
      offsetY: pending.offsetY,
    }
    dragDropTargetRef.current = { status: null, index: null }
    dragHasMovedRef.current = false
    updateFloatingDragPosition()
    setDragState({
      ...pending,
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
      overStatus: null,
      overIndex: null,
      hasMoved: false,
    })
  }

  function updateActivePointerDrag(
    pointer: { clientX: number; clientY: number },
    activeDrag: Pick<DragState, 'offsetX' | 'offsetY' | 'startX' | 'startY' | 'pointerType' | 'propostaId'>
  ) {
    dragPointRef.current = { x: pointer.clientX, y: pointer.clientY }
    dragVisualRef.current = {
      x: pointer.clientX,
      y: pointer.clientY,
      offsetX: activeDrag.offsetX,
      offsetY: activeDrag.offsetY,
    }
    updateFloatingDragPosition()

    const overTarget = getTouchDropTarget(pointer.clientX, pointer.clientY, activeDrag.propostaId)
    const dragDistance = Math.hypot(pointer.clientX - activeDrag.startX, pointer.clientY - activeDrag.startY)
    dragDropTargetRef.current = overTarget
    dragHasMovedRef.current =
      dragHasMovedRef.current ||
      dragDistance >=
        (activeDrag.pointerType === 'mouse' ? MOUSE_DRAG_START_DISTANCE : TOUCH_DRAG_START_DISTANCE)
  }

  const shouldRequireMoveComment = useCallback(
    (
      proposta: Proposta,
      targetStatus: StatusProposta,
      sellerWorkflowAction?: SellerMoveAction | ''
    ) => {
      if (sellerWorkflowAction === 'fechado') return true
      if (sellerWorkflowAction === 'em_retificacao') return hasRuleAccess(user, 'requireRetificationJustification')
      if (sellerWorkflowAction === 'perdido') return hasRuleAccess(user, 'requireLostJustification')
      if (sellerWorkflowAction === 'stand_by') return hasRuleAccess(user, 'requireStandByJustification')

      if (!sellerWorkflowAction && ['fechado', 'em_retificacao', 'perdido', 'stand_by'].includes(targetStatus)) {
        if (targetStatus === 'fechado') return true
        if (targetStatus === 'em_retificacao') return hasRuleAccess(user, 'requireRetificationJustification')
        if (targetStatus === 'perdido') return hasRuleAccess(user, 'requireLostJustification')
        if (targetStatus === 'stand_by') return hasRuleAccess(user, 'requireStandByJustification')
      }

      return false
    },
    [user]
  )

  const requestMove = async (propostaId: string, targetStatus: StatusProposta, targetIndex?: number | null) => {
    const proposta = propostasById.get(propostaId)
    const sourceDisplayStatus = proposta ? resolveKanbanDisplayStatus(proposta.status) : null
    const isCommercialCard = Boolean(sourceDisplayStatus && SELLER_COLUMNS.includes(sourceDisplayStatus))
    const canOpenSameStatusGuidedAction =
      proposta?.status === targetStatus &&
      isCommercialCard &&
      ['vendedor', 'admin', 'gerente'].includes(user?.role || '')

    if (!proposta) {
      return
    }

    const sourceIndex =
      sourceDisplayStatus && propostasByStatus[sourceDisplayStatus]
        ? propostasByStatus[sourceDisplayStatus].findIndex((item) => item.id === proposta.id)
        : -1
    const isSameColumnReorder =
      sourceDisplayStatus === targetStatus &&
      typeof targetIndex === 'number' &&
      targetIndex !== sourceIndex

    if (isSameColumnReorder) {
      void executeMove(proposta, {
        targetStatus: proposta.status,
        kanbanPosition: targetIndex,
      })
      return
    }

    if (user?.role !== 'admin' && targetStatus === 'pos_fechamento' && proposta.status !== 'fechado') {
      toast.error('A proposta so pode ir para pos-fechamento quando estiver na coluna Fechado.')
      return
    }

    if (user?.role !== 'admin' && targetStatus === 'pos_fechamento' && !canMoveToPostClosing) {
      toast.error('Este usuario nao tem permissao para mover propostas para pos-fechamento.')
      return
    }

    if (proposta.status === targetStatus && !canOpenSameStatusGuidedAction) {
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
      const fallbackOrcamentistaId =
        user?.role === 'orcamentista' ? user.id : null
      const loadedProposalAlreadyReady = isProposalReadyForApproval(proposta as Proposta & Record<string, unknown>, {
        requirePdf: requiresApprovalPdfRule,
        requireTechnicalData: requiresApprovalTechnicalDataRule,
        requireOrcamentista: requiresApprovalOrcamentistaRule,
        fallbackOrcamentistaId,
      })

      if (loadedProposalAlreadyReady) {
        void executeMove(proposta, { targetStatus, kanbanPosition: targetIndex ?? 0 })
        return
      }

      try {
        const response = await fetch(`/api/propostas/${proposta.id}`)
        if (response.ok) {
          const detailedProposal = (await response.json()) as Proposta & Record<string, unknown>
          const hasRequiredApprovalSnapshot = isProposalReadyForApproval(detailedProposal, {
            requirePdf: requiresApprovalPdfRule,
            requireTechnicalData: requiresApprovalTechnicalDataRule,
            requireOrcamentista: requiresApprovalOrcamentistaRule,
            fallbackOrcamentistaId,
          })

          if (hasRequiredApprovalSnapshot) {
            void executeMove(proposta, { targetStatus, kanbanPosition: targetIndex ?? 0 })
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
      void executeMove(proposta, { targetStatus, kanbanPosition: targetIndex ?? 0 })
      return
    }

    setPendingMove({ propostaId, targetStatus, targetIndex: targetIndex ?? null })
    const shouldPresetSellerAction =
      user?.role === 'vendedor' &&
      proposta.status !== targetStatus &&
      [
        'enviado_ao_cliente',
        'follow_up_1_dia',
        'follow_up_3_dias',
        'follow_up_7_dias',
        'fechado',
        'perdido',
        'em_retificacao',
        'stand_by',
      ].includes(targetStatus)
    setSellerAction(
      shouldPresetSellerAction
        ? (targetStatus as SellerMoveAction)
        : user?.role === 'vendedor' && proposta.status === 'enviar_ao_cliente' && targetStatus === proposta.status
        ? 'enviado_ao_cliente'
        : ''
    )
    setAdminMoveStatus('')
    setMoveComment('')
    setMoveValue(proposta.valor > 0 ? String(proposta.valor) : '')
    setMoveFiles([])
    setCloseClientTipo(inferClientType(cliente || null))
    setFollowUpTime(
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(targetStatus)
        ? (proposta.followUpTime || currentTime).slice(0, 5)
        : (proposta.followUpTime || '').slice(0, 5)
    )
    setCloseClientTipo(inferClientType(cliente))
    setCloseClientName(cliente?.nome || proposta.clienteNome || '')
    setCloseClientCpf(cliente?.cpf || '')
    setCloseClientEmail(cliente?.email || '')
    setCloseClientPhone(cliente?.telefone || '')
    setCloseClientAddress(cliente?.endereco || '')
    setCloseClientNumber(cliente?.numero || '')
    setCloseClientDistrict(cliente?.bairro || '')
  }

  const handleTouchPointerDown = (event: React.PointerEvent<HTMLDivElement>, proposta: Proposta) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || isInteractiveTarget(event.target)) {
      return
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
        updateActivePointerDrag(event, pending)
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
    updateActivePointerDrag(event, dragState)
  }

  const finishTouchDrag = (pointerId: number, options?: { commit?: boolean }) => {
    const shouldCommit = options?.commit ?? true
    const activeTouchDrag = dragState
    const pending = touchPendingDragRef.current
    const captureElement = pending?.element

    if (pending?.pointerId === pointerId) {
      clearTouchPendingDrag(true)
    }

    if (!activeTouchDrag || activeTouchDrag.pointerId !== pointerId) {
      return
    }

    const sourceDisplayStatus = resolveKanbanDisplayStatus(activeTouchDrag.sourceStatus)
    const currentDropTarget = dragDropTargetRef.current
    const sourceIndex = propostasByStatus[sourceDisplayStatus].findIndex(
      (proposta) => proposta.id === activeTouchDrag.propostaId
    )
    const hasColumnChanged = Boolean(currentDropTarget.status && currentDropTarget.status !== sourceDisplayStatus)
    const hasIndexChanged =
      currentDropTarget.status === sourceDisplayStatus &&
      typeof currentDropTarget.index === 'number' &&
      currentDropTarget.index !== sourceIndex

    if (
      shouldCommit &&
      dragHasMovedRef.current &&
      currentDropTarget.status &&
      (hasColumnChanged || hasIndexChanged)
    ) {
      requestMove(activeTouchDrag.propostaId, currentDropTarget.status, currentDropTarget.index)
    }

    if (captureElement?.hasPointerCapture?.(pointerId)) {
      try {
        captureElement.releasePointerCapture(pointerId)
      } catch {
        // Ignora falhas de release em navegadores touch mais limitados.
      }
    }

    dragPointRef.current = null
    dragVisualRef.current = null
    dragDropTargetRef.current = { status: null, index: null }
    dragHasMovedRef.current = false
    setDragState(null)
  }

  const handleTouchPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    finishTouchDrag(event.pointerId, { commit: true })
  }

  const handleTouchPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    finishTouchDrag(event.pointerId, { commit: false })
  }

  const executeMove = useCallback(
    async (
      proposta: Proposta,
      options: {
        targetStatus: StatusProposta
        kanbanPosition?: number | null
        sellerWorkflowAction?: SellerMoveAction | ''
        adminStatus?: StatusProposta | ''
        comment?: string
        followUpTime?: string
        moveValue?: string
        moveFiles?: File[]
        orcamentistaIdOverride?: string | null
        closeClientData?: {
          tipo: TipoCliente
          nome: string
          cpf: string
          email: string
          telefone: string
          endereco: string
          numero?: string
          bairro?: string
          cidade?: string
          estado?: string
          cep?: string
        }
        dialogSnapshot?: PendingMoveDialogSnapshot
      }
    ) => {
      if (isSubmittingMoveRef.current) return

      const effectiveSellerWorkflowAction = options.sellerWorkflowAction || ''
      const baseTargetStatus = options.adminStatus || options.targetStatus
      const resolvedStatus = (() => {
        if (effectiveSellerWorkflowAction) {
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
      const followUpTimeForMove =
        options.followUpTime ||
        (resolvedStatus === 'enviado_ao_cliente'
          ? formatFollowUpTimeForSubmission(new Date())
          : proposta.followUpTime || null)
      const isBudgetWorkflowMove = ['em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(
        persistedStatus
      )
      const resolvedMoveOrcamentistaId =
        (options.orcamentistaIdOverride !== undefined ? options.orcamentistaIdOverride : proposta.orcamentistaId) ||
        (user?.role === 'orcamentista' && isBudgetWorkflowMove ? user.id : null)

      const parsedSubmittedValue = parseProposalNumericInput(options.moveValue || '')
      const shouldUseSubmittedValue =
        persistedStatus === 'fechado' ||
        (persistedStatus === 'aguardando_aprovacao' && (parsedSubmittedValue ?? 0) > 0)
      const nextValue = shouldUseSubmittedValue ? (parsedSubmittedValue ?? 0) : proposta.valor
      const optimisticPatch: Partial<Proposta> = {
        status: persistedStatus,
        valor: nextValue,
        followUpTime: followUpTimeForMove,
        kanbanOrder: options.kanbanPosition ?? proposta.kanbanOrder ?? null,
      }

      isSubmittingMoveRef.current = true
      setIsSubmittingMove(true)
      setOptimisticPropostas((prev) => ({ ...prev, [proposta.id]: optimisticPatch }))
      setUpdatingProposalIds((prev) => ({ ...prev, [proposta.id]: true }))

      try {
        const proposalMovePayload: Record<string, unknown> = {
          status: effectiveSellerWorkflowAction ? proposta.status : resolvedStatus,
          followUpTime: followUpTimeForMove,
          kanbanPosition: options.kanbanPosition ?? null,
          ...(options.comment ? { comentario: options.comment, justificativa: options.comment } : {}),
          ...(effectiveSellerWorkflowAction ? { workflowAction: effectiveSellerWorkflowAction } : {}),
          ...(persistedStatus === 'aguardando_aprovacao' && (parsedSubmittedValue ?? 0) > 0
            ? { valor: nextValue }
            : {}),
          ...(isBudgetWorkflowMove
            ? {
                responsavelId: proposta.responsavelId || null,
                orcamentistaId: resolvedMoveOrcamentistaId,
              }
            : {}),
          ...(persistedStatus === 'fechado'
            ? {
                clienteTipo: options.closeClientData?.tipo || null,
                clienteNome: options.closeClientData?.nome || null,
                clienteCpf: options.closeClientData?.cpf || null,
                clienteEmail: options.closeClientData?.email || null,
                clienteTelefone: options.closeClientData?.telefone || null,
                clienteEndereco: options.closeClientData?.endereco || null,
                clienteNumero: options.closeClientData?.numero || null,
                clienteBairro: options.closeClientData?.bairro || null,
                clienteCidade: options.closeClientData?.cidade || null,
                clienteEstado: options.closeClientData?.estado || null,
                clienteCep: options.closeClientData?.cep || null,
                clienteValorFechado: nextValue,
              }
            : {}),
          ...(options.moveFiles?.length ? { anexos: options.moveFiles } : {}),
        }

        const updatedProposal = (await updateProposta({
          id: proposta.id,
          ...proposalMovePayload,
        } as Proposta)) as Partial<Proposta> & Record<string, unknown>
        const updatedValue = parseProposalNumericInput(String(updatedProposal.valor ?? ''))
        const updatedKanbanOrder = parseProposalNumericInput(
          String(updatedProposal.kanbanOrder ?? updatedProposal.kanban_order ?? '')
        )
        setOptimisticPropostas((prev) => ({
          ...prev,
          [proposta.id]: {
            ...optimisticPatch,
            status: (updatedProposal.status as StatusProposta | undefined) || optimisticPatch.status,
            valor: updatedValue != null ? updatedValue : optimisticPatch.valor,
            responsavelId:
              typeof updatedProposal.responsavelId === 'string'
                ? updatedProposal.responsavelId
                : optimisticPatch.responsavelId,
            orcamentistaId:
              typeof updatedProposal.orcamentistaId === 'string'
                ? updatedProposal.orcamentistaId
                : optimisticPatch.orcamentistaId,
            kanbanOrder: updatedKanbanOrder != null ? updatedKanbanOrder : optimisticPatch.kanbanOrder,
            followUpTime:
              typeof updatedProposal.followUpTime === 'string'
                ? updatedProposal.followUpTime
                : optimisticPatch.followUpTime,
          },
        }))
        toast.success('Proposta atualizada com sucesso.')
        resetPendingMoveDialog()
      } catch (error: any) {
        setOptimisticPropostas((prev) => {
          const next = { ...prev }
          delete next[proposta.id]
          return next
        })
        if (options.dialogSnapshot) {
          restorePendingMoveDialog(options.dialogSnapshot)
        }
        toast.error(error?.message || 'Nao foi possivel atualizar a proposta.')
      } finally {
        isSubmittingMoveRef.current = false
        setIsSubmittingMove(false)
        setUpdatingProposalIds((prev) => {
          const next = { ...prev }
          delete next[proposta.id]
          return next
        })
      }
    },
    [resetPendingMoveDialog, restorePendingMoveDialog, updateProposta, user?.id, user?.role]
  )

  const confirmMove = async () => {
    if (!pendingMove || isSubmittingMoveRef.current) return
    const proposta = propostasById.get(pendingMove.propostaId)
    if (!proposta) return

    const dialogSnapshot: PendingMoveDialogSnapshot = {
      pendingMove,
      sellerAction,
      adminMoveStatus,
      moveComment,
      followUpTime,
      moveValue,
      moveFiles,
      closeClientData: {
        tipo: closeClientTipo,
        nome: closeClientName,
        cpf: closeClientCpf,
        email: closeClientEmail,
        telefone: closeClientPhone,
        endereco: closeClientAddress,
        numero: closeClientNumber,
        bairro: closeClientDistrict,
        cidade: closeClientCity,
        estado: closeClientState,
        cep: closeClientCep,
      },
    }

    setPendingMove(null)

    await executeMove(proposta, {
      targetStatus: pendingMove.targetStatus,
      kanbanPosition: pendingMove.targetIndex ?? 0,
      sellerWorkflowAction: isSellerMove ? effectiveSellerAction : '',
      adminStatus: isAdminCommercialMove ? adminMoveStatus : '',
      comment: requiresMoveComment ? moveComment : '',
      followUpTime: followUpTime || proposta.followUpTime || undefined,
      moveValue,
      moveFiles,
      orcamentistaIdOverride:
        resolvedTargetStatus === 'aguardando_aprovacao' ? resolvedApprovalOrcamentistaId : undefined,
      closeClientData: requiresClosedClientData
        ? {
            tipo: closeClientTipo,
            nome: closeClientName,
            cpf: closeClientCpf,
            email: closeClientEmail,
            telefone: closeClientPhone,
            endereco: closeClientAddress,
            numero: closeClientNumber,
            bairro: closeClientDistrict,
            cidade: closeClientCity,
            estado: closeClientState,
            cep: closeClientCep,
          }
        : undefined,
      dialogSnapshot,
    })
  }

  const pendingMoveProposal = pendingMove
    ? propostasById.get(pendingMove.propostaId) || null
    : null
  const pendingMoveClient = pendingMoveProposal
    ? lookups.clientesById.get(pendingMoveProposal.clienteId) || null
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
    ? getAdminCommercialStatusOptions(
        pendingMoveDisplayStatus || pendingMoveProposal.status,
        user?.role,
        canMoveToPostClosing
      )
    : []
  const selectedSellerAction = isSellerMove ? sellerAction : ''
  const isSellerDirectTargetMove =
    isSellerMove &&
    Boolean(
      pendingMoveProposal &&
        pendingMove?.targetStatus &&
        pendingMove.targetStatus !== pendingMoveProposal.status &&
        [
          'enviado_ao_cliente',
          'follow_up_1_dia',
          'follow_up_3_dias',
          'follow_up_7_dias',
          'fechado',
          'perdido',
          'em_retificacao',
          'stand_by',
        ].includes(pendingMove.targetStatus)
    )
  const sellerCanOnlyConfirmSend =
    isSellerMove &&
    pendingMoveProposal?.status === 'enviar_ao_cliente' &&
    !isSellerDirectTargetMove &&
    (!selectedSellerAction || selectedSellerAction === 'enviado_ao_cliente')
  const effectiveSellerAction =
    isSellerDirectTargetMove && pendingMove?.targetStatus
      ? (pendingMove.targetStatus as SellerMoveAction)
      : sellerCanOnlyConfirmSend && isSellerMove
      ? ('enviado_ao_cliente' as SellerMoveAction)
      : (selectedSellerAction as SellerMoveAction | '')
  const shouldShowSellerActionSelect = isSellerMove && !sellerCanOnlyConfirmSend && !isSellerDirectTargetMove
  const resolvedAdminMoveStatus = isAdminCommercialMove ? adminMoveStatus : pendingMove?.targetStatus || ''
  const resolvedTargetStatus = (() => {
    if (isSellerMove && effectiveSellerAction && pendingMoveProposal) {
      return effectiveSellerAction as StatusProposta
    }

    return resolvedAdminMoveStatus as StatusProposta
  })()
  const statusSelectedForCommentFlow =
    (isSellerMove && (sellerCanOnlyConfirmSend || Boolean(effectiveSellerAction))) ||
    (isAdminCommercialMove && Boolean(adminMoveStatus)) ||
    (!isSellerMove && !isAdminCommercialMove)
  const approvalValidationProposalId =
    pendingMove &&
    ['orcamentista', 'admin'].includes(user?.role || '') &&
    resolvedTargetStatus === 'aguardando_aprovacao'
      ? pendingMove.propostaId
      : null
  const {
    proposta: approvalValidationProposalData,
    isLoading: isLoadingApprovalValidationProposal,
    error: approvalValidationProposalError,
  } = useProposta(approvalValidationProposalId)
  const requiresMoveComment = pendingMoveProposal
    ? statusSelectedForCommentFlow
      ? shouldRequireMoveComment(
          pendingMoveProposal,
          (resolvedTargetStatus || pendingMove?.targetStatus || pendingMoveProposal.status) as StatusProposta,
          effectiveSellerAction
        )
      : false
    : false
  const requiresFollowUpTime =
    (isSellerMove &&
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(effectiveSellerAction || '')) ||
    (!isSellerMove &&
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(resolvedTargetStatus || ''))
  const approvalValidationActive =
    ['orcamentista', 'admin'].includes(user?.role || '') &&
    resolvedTargetStatus === 'aguardando_aprovacao'
  const approvalRequirementsReady = !approvalValidationActive || !isLoadingApprovalValidationProposal
  const approvalValidationCanInspectRequirements =
    approvalValidationActive && approvalRequirementsReady && Boolean(approvalValidationProposalData)
  const approvalTargetProposal = approvalValidationCanInspectRequirements
    ? approvalValidationProposalData
    : pendingMoveProposal
  const requiresApprovalPdfRule = hasRuleAccess(user, 'requireApprovalPdf')
  const requiresApprovalTechnicalDataRule = hasRuleAccess(user, 'requireApprovalTechnicalData')
  const requiresApprovalOrcamentistaRule = hasRuleAccess(user, 'requireApprovalOrcamentista')
  const requiresClosedClientDataRule = hasRuleAccess(user, 'requireClosedClientData')
  const hasExistingProposalPdf = approvalTargetProposal
    ? Array.isArray(approvalTargetProposal.anexos)
      ? approvalTargetProposal.anexos.some(isPdfAttachment)
      : false
    : false
  const parsedMoveValue = parseProposalNumericInput(moveValue)
  const existingApprovalValue =
    approvalTargetProposal
      ? readPositiveNumber(
          approvalTargetProposal.valor,
          (approvalTargetProposal as Partial<Proposta> & Record<string, unknown>).valor_final
        )
      : 0
  const approvalTargetRecord =
    (approvalTargetProposal || {}) as Partial<Proposta> & Record<string, unknown>
  const existingApprovalAreaM2 =
    readPositiveNumber(approvalTargetRecord.areaM2, approvalTargetRecord.area_m2)
  const existingApprovalPerfisBruto =
    readPositiveNumber(approvalTargetRecord.perfisBruto, approvalTargetRecord.perfis_bruto)
  const existingApprovalPerfisLiquidos =
    readPositiveNumber(approvalTargetRecord.perfisLiquidos, approvalTargetRecord.perfis_liquidos)
  const existingApprovalValorVidro =
    readPositiveNumber(approvalTargetRecord.valorVidro, approvalTargetRecord.valor_vidro)
  const existingApprovalValorAcessorios =
    readPositiveNumber(approvalTargetRecord.valorAcessorios, approvalTargetRecord.valor_acessorios)
  const proposalNeedsApprovalValue = approvalValidationCanInspectRequirements && existingApprovalValue <= 0
  const technicalApprovalValues = approvalValidationCanInspectRequirements
    ? [
        existingApprovalAreaM2,
        existingApprovalPerfisBruto,
        existingApprovalPerfisLiquidos,
        existingApprovalValorVidro,
        existingApprovalValorAcessorios,
      ]
    : []
  const proposalNeedsTechnicalData = approvalValidationCanInspectRequirements && requiresApprovalTechnicalDataRule
    ? !technicalApprovalValues.some((value) => value > 0)
    : false
  const requiresBudgetValue = proposalNeedsApprovalValue
  const requiresAttachment =
    approvalValidationCanInspectRequirements && requiresApprovalPdfRule && !hasExistingProposalPdf
  const hasRequiredPdfAttachment = !requiresAttachment || moveFiles.some(isPdfFile)
  const approvalRequirementItems = approvalValidationActive
    ? [
        proposalNeedsApprovalValue ? 'informar o valor do orcamento' : null,
        requiresAttachment ? 'anexar a proposta em PDF' : null,
        requiresApprovalOrcamentistaRule &&
        !(
          getProposalOrcamentistaId(approvalTargetRecord) ||
          getProposalOrcamentistaId((pendingMoveProposal || {}) as Partial<Proposta> & Record<string, unknown>) ||
          (user?.role === 'orcamentista' && resolvedTargetStatus === 'aguardando_aprovacao' ? user.id : null)
        )
          ? 'definir um orcamentista responsavel'
          : null,
        proposalNeedsTechnicalData
          ? 'preencher ao menos um dado tecnico (area em m2, perfis bruto, perfis liquidos, valor de vidro ou valor de acessorios)'
          : null,
      ].filter((item): item is string => Boolean(item))
    : []
  const approvalRequirementsSyncMessage =
    approvalValidationActive && approvalRequirementsReady && !approvalValidationProposalData
      ? approvalValidationProposalError
        ? 'Nao foi possivel validar os dados obrigatorios desta proposta agora. Se voce confirmar, a API fara a validacao final.'
        : 'Sincronizando os dados mais recentes da proposta para validar a aprovacao.'
      : null
  const approvalRequirementsMessage = approvalValidationActive
    ? approvalRequirementsSyncMessage
      ? approvalRequirementsSyncMessage
      : approvalRequirementItems.length > 0
        ? `Para enviar esta proposta para aprovacao, complete os itens obrigatorios: ${approvalRequirementItems.join('; ')}.`
        : 'Esta proposta ja tem os dados obrigatorios para seguir para aprovacao.'
    : null
  const resolvedApprovalOrcamentistaId =
    (requiresApprovalOrcamentistaRule ? getProposalOrcamentistaId(approvalTargetRecord) : null) ||
    getProposalOrcamentistaId((pendingMoveProposal || {}) as Partial<Proposta> & Record<string, unknown>) ||
    (user?.role === 'orcamentista' && resolvedTargetStatus === 'aguardando_aprovacao' ? user.id : null)
  const closeClientDocumentLabel = getClientDocumentLabel(closeClientTipo)
  const closeClientDocumentPlaceholder = getClientDocumentPlaceholder(closeClientTipo)
  const handleCloseClientCepLookup = async () => {
    const result = await lookupCep(closeClientCep)
    if (!result) {
      toast.error('Nao foi possivel localizar esse CEP.')
      return
    }

    setCloseClientCep(formatCep(result.cep))
    if (result.logradouro || result.endereco) setCloseClientAddress(result.logradouro || result.endereco)
    if (result.bairro) setCloseClientDistrict(result.bairro)
    if (result.cidade) setCloseClientCity(result.cidade)
    if (result.estado) setCloseClientState(result.estado)
    setCepLookupError('')
    toast.success('Endereco preenchido pelo CEP.')
  }
  const requiresClosedClientData =
    effectiveSellerAction === 'fechado' || (!isSellerMove && resolvedTargetStatus === 'fechado')
  const requiresMandatoryClosedClientData = requiresClosedClientData && requiresClosedClientDataRule
  const hasInvalidClosedClientDocument =
    requiresClosedClientData &&
    closeClientCpf.trim() !== '' &&
    !isValidClientDocument(closeClientCpf, closeClientTipo)
  const hasInvalidMoveValue = moveValue.trim() !== '' && parsedMoveValue === null
  const isSchedulingFollowUp = requiresFollowUpTime
  const pendingMoveTargetLabel = pendingMove ? statusPropostaLabels[pendingMove.targetStatus] : ''
  const draggedTouchProposal = dragState ? propostasById.get(dragState.propostaId) || null : null
  const sellerActionDialogCopy = getSellerActionDialogCopy(effectiveSellerAction)
  const openProposalDetails = useCallback((proposalId: string) => {
    void prefetchProposta(proposalId)
    setDetailsPropostaId(proposalId)
  }, [])

  useEffect(() => {
    if (!isSellerMove || !pendingMoveProposal || !pendingMove?.targetStatus) {
      return
    }

    const directActionTargets: SellerMoveAction[] = [
      'enviado_ao_cliente',
      'follow_up_1_dia',
      'follow_up_3_dias',
      'follow_up_7_dias',
      'fechado',
      'perdido',
      'em_retificacao',
      'stand_by',
    ]

    if (
      pendingMoveProposal.status === 'enviar_ao_cliente' &&
      pendingMove.targetStatus === pendingMoveProposal.status
    ) {
      if (sellerAction !== 'enviado_ao_cliente') {
        setSellerAction('enviado_ao_cliente')
      }
      return
    }

    if (
      pendingMove.targetStatus !== pendingMoveProposal.status &&
      directActionTargets.includes(pendingMove.targetStatus as SellerMoveAction) &&
      sellerAction !== pendingMove.targetStatus
    ) {
      setSellerAction(pendingMove.targetStatus as SellerMoveAction)
    }
  }, [isSellerMove, pendingMove?.targetStatus, pendingMoveProposal, sellerAction])

  useEffect(() => {
    if (!requiresClosedClientData || !pendingMoveProposal) {
      return
    }

    const proposalFallbackName = pendingMoveProposal.clienteNome || ''
    const clientName = pendingMoveClient?.nome || ''
    const nextClientType = inferClientType(pendingMoveClient)
    const nextCloseClientData = {
      tipo: nextClientType,
      nome: clientName || proposalFallbackName,
      cpf: pendingMoveClient?.cpf || '',
      email: pendingMoveClient?.email || '',
      telefone: pendingMoveClient?.telefone || '',
      endereco: pendingMoveClient?.endereco || '',
      numero: pendingMoveClient?.numero || '',
      bairro: pendingMoveClient?.bairro || '',
      cidade: pendingMoveClient?.cidade || '',
      estado: pendingMoveClient?.estado || '',
      cep: formatCep(pendingMoveClient?.cep || ''),
    }

    setCloseClientTipo((current) => (current !== nextCloseClientData.tipo ? nextCloseClientData.tipo : current))
    setCloseClientName((current) =>
      !current.trim()
        ? nextCloseClientData.nome
        : clientName && current === proposalFallbackName && current !== clientName
          ? clientName
          : current
    )
    setCloseClientCpf((current) =>
      !current.trim() && nextCloseClientData.cpf ? nextCloseClientData.cpf : current
    )
    setCloseClientEmail((current) =>
      !current.trim() && nextCloseClientData.email ? nextCloseClientData.email : current
    )
    setCloseClientPhone((current) =>
      !current.trim() && nextCloseClientData.telefone ? nextCloseClientData.telefone : current
    )
    setCloseClientAddress((current) =>
      !current.trim() && nextCloseClientData.endereco ? nextCloseClientData.endereco : current
    )
    setCloseClientNumber((current) =>
      !current.trim() && nextCloseClientData.numero ? nextCloseClientData.numero : current
    )
    setCloseClientDistrict((current) =>
      !current.trim() && nextCloseClientData.bairro ? nextCloseClientData.bairro : current
    )
    setCloseClientCity((current) =>
      !current.trim() && nextCloseClientData.cidade ? nextCloseClientData.cidade : current
    )
    setCloseClientState((current) =>
      !current.trim() && nextCloseClientData.estado ? nextCloseClientData.estado : current
    )
    setCloseClientCep((current) =>
      !current.trim() && nextCloseClientData.cep ? nextCloseClientData.cep : current
    )
  }, [
    pendingMove?.targetStatus,
    pendingMoveClient?.cpf,
    pendingMoveClient?.email,
    pendingMoveClient?.endereco,
    pendingMoveClient?.numero,
    pendingMoveClient?.bairro,
    pendingMoveClient?.cidade,
    pendingMoveClient?.nome,
    pendingMoveClient?.estado,
    pendingMoveClient?.telefone,
    pendingMoveClient?.cep,
    pendingMoveProposal,
    requiresClosedClientData,
  ])
  useEffect(() => {
    if (!dragState || typeof window === 'undefined') {
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
      let didScroll = false

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
          didScroll = true
        }
      }

      const liveDropTarget = dragState ? getTouchDropTarget(dragPoint.x, dragPoint.y, dragState.propostaId) : null
      dragDropTargetRef.current = liveDropTarget || { status: null, index: null }
      const activeScrollStatus = liveDropTarget?.status || null
      const activeColumnScroller = activeScrollStatus ? columnScrollRefs.current[activeScrollStatus] : null

      if (activeColumnScroller) {
        const scrollerRect = activeColumnScroller.getBoundingClientRect()
        let deltaY = 0

        if (dragPoint.y >= scrollerRect.bottom - TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX) {
          const intensity = Math.min(
            1,
            (dragPoint.y - (scrollerRect.bottom - TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX)) /
              TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX
          )
          deltaY = Math.ceil(TOUCH_AUTO_SCROLL_VERTICAL_MAX_STEP * Math.max(0.16, intensity))
        } else if (dragPoint.y <= scrollerRect.top + TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX) {
          const intensity = Math.min(
            1,
            ((scrollerRect.top + TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX) - dragPoint.y) /
              TOUCH_AUTO_SCROLL_VERTICAL_EDGE_PX
          )
          deltaY = -Math.ceil(TOUCH_AUTO_SCROLL_VERTICAL_MAX_STEP * Math.max(0.16, intensity))
        }

        if (deltaY !== 0) {
          const previousScrollTop = activeColumnScroller.scrollTop
          activeColumnScroller.scrollTop += deltaY
          if (activeColumnScroller.scrollTop !== previousScrollTop) {
            didScroll = true
          }
        }
      }

      if (didScroll && dragVisualRef.current) {
        updateFloatingDragPosition()
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
  }, [dragState, updateFloatingDragPosition])

  return (
    <>
      <div
        ref={scrollContainerRef}
        className={`crm-scrollbar flex min-h-[calc(100vh-12rem)] items-stretch gap-4 overflow-x-auto pb-4 ${dragState ? 'touch-none' : ''}`}
      >
        {visibleColumns.map((status) => {
          const propostasDaColuna = columnSummaries[status].propostas
          const valorTotal = columnSummaries[status].valorTotal

          return (
            <div
              key={status}
              data-kanban-column-status={status}
              className={`flex h-[calc(100vh-14rem)] min-h-[30rem] w-80 min-w-80 flex-col rounded-lg border-t-4 bg-card transition-colors ${
                columnBorderColors[status]
              }`}
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

              <div
                ref={(node) => {
                  columnScrollRefs.current[status] = node
                }}
                data-kanban-column-scroller={status}
                className="crm-scrollbar-subtle flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="space-y-3">
                {propostasDaColuna.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    Nenhuma proposta nesta etapa
                  </div>
                ) : (
                  propostasDaColuna.map((proposta) => {
                    const cardState = getCardState(proposta)
                    const clientName =
                      lookups.clientesById.get(proposta.clienteId)?.nome || proposta.clienteNome || 'Cliente'
                    const cardTitle = getProposalCardTitle(proposta, clientName)
                    const shouldShowClientLine = clientName && cardTitle.trim() !== clientName.trim()
                    return (
                      <div
                        key={proposta.id}
                        data-kanban-card-id={proposta.id}
                        data-kanban-card-status={status}
                        aria-busy={Boolean(updatingProposalIds[proposta.id])}
                        onPointerDown={(event) => handleTouchPointerDown(event, proposta)}
                        onPointerMove={handleTouchPointerMove}
                        onPointerUp={handleTouchPointerEnd}
                        onPointerCancel={handleTouchPointerCancel}
                        onContextMenu={(event) => event.preventDefault()}
                        className={`rounded-xl border p-4 shadow-sm transition ${cardState.classes} ${
                          updatingProposalIds[proposta.id] ? 'opacity-70' : ''
                        } ${
                          dragState?.propostaId === proposta.id
                            ? 'opacity-35 scale-[0.98]'
                            : ''
                        } cursor-grab select-none [-webkit-touch-callout:none] active:cursor-grabbing`}
                        style={{ touchAction: isTouchDevice ? 'auto' : undefined }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              {proposta.numero || 'Sem numero'}
                            </p>
                            <p className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
                              {cardTitle}
                            </p>
                            {shouldShowClientLine ? (
                              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                                {clientName}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-1 py-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="rounded-full text-muted-foreground hover:text-foreground"
                              title="Ver detalhes"
                              aria-label="Ver detalhes"
                              onPointerEnter={() => void prefetchProposta(proposta.id)}
                              onFocus={() => void prefetchProposta(proposta.id)}
                              onClick={() => openProposalDetails(proposta.id)}
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

                        <p className="mt-3 text-lg font-bold text-foreground">
                          {formatCurrency(proposta.valor)}
                        </p>

                        <ProposalMaterialTagList value={proposta.materialTag} />

                        {proposta.status === 'pos_fechamento' ? (
                          <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{getCurrentPostClosingLabel(proposta)}</span>
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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

                        {status === 'aguardando_aprovacao' && hasRuleAccess(user, 'canApproveReadyProposals') ? (
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
            </div>
          )
        })}
      </div>

      {dragState && draggedTouchProposal ? (
        <div
          ref={floatingDragCardRef}
          className="pointer-events-none fixed left-0 top-0 z-[70] w-80 max-w-[calc(100vw-2rem)] will-change-transform"
          style={{
            transform: `translate3d(${dragState.currentX - dragState.offsetX}px, ${dragState.currentY - dragState.offsetY}px, 0)`,
          }}
        >
          <div className="rounded-xl border border-primary/40 bg-card/95 p-4 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {draggedTouchProposal.numero || 'Sem numero'}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {getProposalCardTitle(
                    draggedTouchProposal,
                    lookups.clientesById.get(draggedTouchProposal.clienteId)?.nome ||
                      draggedTouchProposal.clienteNome ||
                      'Cliente'
                  )}
                </p>
                <p className="mt-2 text-lg font-bold text-foreground">
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
            setCloseClientTipo('residencial')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isSellerMove && !shouldShowSellerActionSelect
                ? sellerActionDialogCopy.title
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
                      {sellerActionDialogCopy.heading}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {sellerActionDialogCopy.description}
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
                {!isLoadingApprovalValidationProposal && proposalNeedsTechnicalData ? (
                  <p className="text-sm text-muted-foreground">
                    Em Ver detalhes, basta preencher pelo menos um dado tecnico para liberar a aprovacao.
                  </p>
                ) : null}
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
                  Informe uma justificativa para registrar nos comentarios desta proposta antes da movimentacao.
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
                  {requiresMandatoryClosedClientData
                    ? 'Complete os dados do cliente para seguir com o fechamento e o contrato.'
                    : 'Se quiser, voce pode complementar os dados do cliente e o valor fechado antes de concluir o fechamento.'}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Tipo de cliente</label>
                    <Select
                      value={closeClientTipo}
                      onValueChange={(value) => {
                        const nextTipo = value as TipoCliente
                        setCloseClientTipo(nextTipo)
                        setCloseClientCpf((current) =>
                          current.trim() ? formatClientDocument(current, nextTipo) : current
                        )
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o tipo do cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="residencial">Residencial</SelectItem>
                        <SelectItem value="comercial">Comercial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Nome completo</label>
                    <Input value={closeClientName} onChange={(event) => setCloseClientName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{closeClientDocumentLabel}</label>
                    <Input
                      value={closeClientCpf}
                      placeholder={closeClientDocumentPlaceholder}
                      onChange={(event) => setCloseClientCpf(event.target.value)}
                      onBlur={(event) =>
                        setCloseClientCpf(formatClientDocument(event.target.value, closeClientTipo))
                      }
                    />
                    {hasInvalidClosedClientDocument ? (
                      <p className="text-sm text-destructive">
                        {getClientDocumentValidationMessage(closeClientTipo)}
                      </p>
                    ) : null}
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
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">CEP</label>
                    <div className="flex gap-2">
                      <Input
                        value={closeClientCep}
                        placeholder="00000-000"
                        onChange={(event) => {
                          setCepLookupError('')
                          setCloseClientCep(formatCep(event.target.value))
                        }}
                        onBlur={(event) => setCloseClientCep(formatCep(event.target.value))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => void handleCloseClientCepLookup()}
                        pending={isLookingUpCep}
                        disabled={isLookingUpCep || closeClientCep.replace(/\D/g, '').length !== 8}
                        aria-label="Buscar endereco pelo CEP"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </div>
                    {cepLookupError ? <p className="text-sm text-destructive">{cepLookupError}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Rua / logradouro</label>
                    <Input
                      value={closeClientAddress}
                      onChange={(event) => setCloseClientAddress(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Numero</label>
                    <Input
                      value={closeClientNumber}
                      placeholder="Ex: 120, sala 4"
                      onChange={(event) => setCloseClientNumber(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Bairro</label>
                    <Input
                      value={closeClientDistrict}
                      onChange={(event) => setCloseClientDistrict(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Cidade</label>
                    <Input
                      value={closeClientCity}
                      onChange={(event) => setCloseClientCity(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Estado</label>
                    <Input
                      value={closeClientState}
                      maxLength={2}
                      placeholder="UF"
                      onChange={(event) => setCloseClientState(event.target.value.toUpperCase())}
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
                    hasInvalidClosedClientDocument ||
                    hasInvalidMoveValue ||
                    (proposalNeedsApprovalValue && (parseProposalNumericInput(moveValue) ?? 0) <= 0) ||
                    proposalNeedsTechnicalData ||
                    !hasRequiredPdfAttachment ||
                    (requiresMoveComment && !moveComment.trim()) ||
                    (requiresFollowUpTime && !followUpTime) ||
                    (requiresMandatoryClosedClientData &&
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
