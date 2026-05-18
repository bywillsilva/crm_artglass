'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mutate } from 'swr'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Circle,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useCRM } from '@/lib/context/crm-context'
import { prefetchProposta, updateProposta, useProposta, useSession } from '@/lib/hooks/use-api'
import {
  posFechamentoEtapaLabels,
  posFechamentoEtapas,
  statusPropostaColors,
  statusPropostaLabels,
  type PosFechamentoEtapa,
  type Proposta,
} from '@/lib/data/types'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
import {
  getCurrentPostClosingLabel,
  getCurrentPostClosingStep,
  isPostClosingStepCompleted,
  postClosingDateFields,
} from '@/lib/utils/post-closing'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

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

function compactSnapshot<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
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
    areaM2:
      typeof primary.areaM2 === 'number'
        ? primary.areaM2
        : typeof fallback.areaM2 === 'number'
          ? fallback.areaM2
          : null,
    perfisBruto:
      typeof primary.perfisBruto === 'number'
        ? primary.perfisBruto
        : typeof fallback.perfisBruto === 'number'
          ? fallback.perfisBruto
          : null,
    perfisLiquidos:
      typeof primary.perfisLiquidos === 'number'
        ? primary.perfisLiquidos
        : typeof fallback.perfisLiquidos === 'number'
          ? fallback.perfisLiquidos
          : null,
    valorPerfil:
      typeof primary.valorPerfil === 'number'
        ? primary.valorPerfil
        : typeof fallback.valorPerfil === 'number'
          ? fallback.valorPerfil
          : null,
    valorVidro:
      typeof primary.valorVidro === 'number'
        ? primary.valorVidro
        : typeof fallback.valorVidro === 'number'
          ? fallback.valorVidro
          : null,
    valorAcessorios:
      typeof primary.valorAcessorios === 'number'
        ? primary.valorAcessorios
        : typeof fallback.valorAcessorios === 'number'
          ? fallback.valorAcessorios
          : null,
    observacoesTecnicas:
      pickProposalValue(primary.observacoesTecnicas, fallback.observacoesTecnicas) || null,
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
    posFechamentoAguardandoContratoAt:
      primary.posFechamentoAguardandoContratoAt ??
      fallback.posFechamentoAguardandoContratoAt ??
      null,
    posFechamentoContratoFeitoAt:
      primary.posFechamentoContratoFeitoAt ?? fallback.posFechamentoContratoFeitoAt ?? null,
    posFechamentoContratoEnviadoAt:
      primary.posFechamentoContratoEnviadoAt ?? fallback.posFechamentoContratoEnviadoAt ?? null,
    posFechamentoContratoAssinadoAt:
      primary.posFechamentoContratoAssinadoAt ??
      fallback.posFechamentoContratoAssinadoAt ??
      null,
    posFechamentoAguardandoPagamentoAt:
      primary.posFechamentoAguardandoPagamentoAt ??
      fallback.posFechamentoAguardandoPagamentoAt ??
      null,
    posFechamentoPagamentoConfirmadoAt:
      primary.posFechamentoPagamentoConfirmadoAt ?? fallback.posFechamentoPagamentoConfirmadoAt ?? null,
    posFechamentoAguardandoOsAt:
      primary.posFechamentoAguardandoOsAt ??
      fallback.posFechamentoAguardandoOsAt ??
      null,
    posFechamentoOrdemServicoLiberadaAt:
      primary.posFechamentoOrdemServicoLiberadaAt ?? fallback.posFechamentoOrdemServicoLiberadaAt ?? null,
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

function parseOptionalNumericInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return parseCurrencyInput(trimmed)
}

function formatTechnicalMetricValue(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-'
  }

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function isOrcamentistaEditableStatus(status?: string | null) {
  return ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(
    String(status || '')
  )
}

type InlineProposalUpdatePayload = Record<string, unknown>

export function ProposalDetailsSheet({
  open,
  onOpenChange,
  propostaId,
  propostaInicial,
}: ProposalDetailsSheetProps) {
  const { formatCurrency, formatDateTime } = useAppSettings()
  const { state } = useCRM()
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
  const [isEditingResponsavel, setIsEditingResponsavel] = useState(false)
  const [editingResponsavelId, setEditingResponsavelId] = useState('')
  const [isEditingTechnicalDetails, setIsEditingTechnicalDetails] = useState(false)
  const [editingAreaM2, setEditingAreaM2] = useState('')
  const [editingPerfisBruto, setEditingPerfisBruto] = useState('')
  const [editingPerfisLiquidos, setEditingPerfisLiquidos] = useState('')
  const [editingValorVidro, setEditingValorVidro] = useState('')
  const [editingValorAcessorios, setEditingValorAcessorios] = useState('')
  const [editingObservacoesTecnicas, setEditingObservacoesTecnicas] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
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
  const availableResponsaveis = useMemo(() => {
    const currentResponsavelId = propostaSource?.responsavelId || ''

    return state.usuarios
      .filter(
        (usuario) =>
          usuario.role === 'vendedor' ||
          usuario.role === 'gerente' ||
          (currentResponsavelId && usuario.id === currentResponsavelId)
      )
      .filter((usuario) => usuario.ativo || usuario.id === currentResponsavelId)
      .sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'))
  }, [propostaSource?.responsavelId, state.usuarios])

  useEffect(() => {
    setNewComment('')
    setEditingCommentId(null)
    setEditingComment('')
    setIsEditingValue(false)
    setEditingValue('')
    setIsEditingDescription(false)
    setEditingDescription('')
    setIsEditingResponsavel(false)
    setEditingResponsavelId('')
    setIsEditingTechnicalDetails(false)
    setEditingAreaM2('')
    setEditingPerfisBruto('')
    setEditingPerfisLiquidos('')
    setEditingValorVidro('')
    setEditingValorAcessorios('')
    setEditingObservacoesTecnicas('')
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

    if (!isEditingResponsavel) {
      setEditingResponsavelId(propostaSource.responsavelId || '')
    }

    if (!isEditingTechnicalDetails) {
      setEditingAreaM2(
        propostaSource.areaM2 != null ? formatTechnicalMetricValue(propostaSource.areaM2) : ''
      )
      setEditingPerfisBruto(
        propostaSource.perfisBruto != null ? formatTechnicalMetricValue(propostaSource.perfisBruto) : ''
      )
      setEditingPerfisLiquidos(
        propostaSource.perfisLiquidos != null ? formatTechnicalMetricValue(propostaSource.perfisLiquidos) : ''
      )
      setEditingValorVidro(
        propostaSource.valorVidro != null ? formatCurrencyInputValue(propostaSource.valorVidro) : ''
      )
      setEditingValorAcessorios(
        propostaSource.valorAcessorios != null ? formatCurrencyInputValue(propostaSource.valorAcessorios) : ''
      )
      setEditingObservacoesTecnicas(propostaSource.observacoesTecnicas || '')
    }
  }, [isEditingDescription, isEditingResponsavel, isEditingTechnicalDetails, isEditingValue, propostaSource])

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
    if (user.role === 'orcamentista') {
      return (
        (
          (!propostaSource.orcamentistaId || propostaSource.orcamentistaId === user.id) &&
          isOrcamentistaEditableStatus(propostaSource.status)
        ) ||
        (hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
          propostaSource.orcamentistaId === user.id)
      )
    }
    return false
  }, [propostaSource, user])

  const canManageProposalContent = useMemo(() => {
    if (!user || !propostaSource) return false
    if (user.role === 'admin' || user.role === 'gerente') return true
    if (user.role === 'orcamentista') {
      return (
        (
          (!propostaSource.orcamentistaId || propostaSource.orcamentistaId === user.id) &&
          isOrcamentistaEditableStatus(propostaSource.status)
        ) ||
        (hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
          propostaSource.orcamentistaId === user.id)
      )
    }
    return false
  }, [propostaSource, user])
  const canManageProposalComments = useMemo(() => {
    if (!user || !propostaSource) return false
    if (user.role === 'admin' || user.role === 'gerente') return true
    if (user.role === 'vendedor') {
      return (
        hasRuleAccess(user, 'allowSellerCommentsOnResponsibleProposals') &&
        propostaSource.responsavelId === user.id
      )
    }
    if (user.role === 'orcamentista') {
      return (
        (
          (!propostaSource.orcamentistaId || propostaSource.orcamentistaId === user.id) &&
          isOrcamentistaEditableStatus(propostaSource.status)
        ) ||
        (hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
          propostaSource.orcamentistaId === user.id)
      )
    }
    return false
  }, [propostaSource, user])

  const canViewTechnicalDetails = useMemo(
    () => hasRuleAccess(user, 'canViewTechnicalProposalData'),
    [user]
  )
  const canEditResponsavel = useMemo(
    () =>
      Boolean(
        propostaSource &&
          canManageProposalContent &&
          hasRuleAccess(user, 'canEditProposalResponsavelDirectly')
      ),
    [canManageProposalContent, propostaSource, user]
  )

  const canEditTechnicalDetails = useMemo(
    () => canViewTechnicalDetails && canInlineEdit,
    [canInlineEdit, canViewTechnicalDetails]
  )
  const canViewPostClosing = useMemo(
    () => Boolean(propostaSource && hasRuleAccess(user, 'canViewPostClosing')),
    [propostaSource, user]
  )
  const canManagePostClosingSteps = useMemo(
    () => Boolean(propostaSource && canViewPostClosing && hasRuleAccess(user, 'canManagePostClosingSteps')),
    [canViewPostClosing, propostaSource, user]
  )
  const currentPostClosingStep = useMemo(
    () => getCurrentPostClosingStep(propostaSource),
    [propostaSource]
  )
  const currentPostClosingLabel = useMemo(
    () => getCurrentPostClosingLabel(propostaSource),
    [propostaSource]
  )
  const shouldShowPostClosing =
    canViewPostClosing &&
    Boolean(
      propostaSource?.status === 'pos_fechamento' ||
        currentPostClosingStep ||
        posFechamentoEtapas.some((step) => Boolean(propostaSource?.[postClosingDateFields[step]]))
    )
  const technicalMetrics = useMemo(
    () => [
      {
        key: 'area',
        label: 'Area (m2)',
        value:
          propostaSource?.areaM2 != null
            ? `${formatTechnicalMetricValue(propostaSource.areaM2)} m2`
            : 'Nao informado',
      },
      {
        key: 'perfis-bruto',
        label: 'Perfis bruto',
        value:
          propostaSource?.perfisBruto != null
            ? formatTechnicalMetricValue(propostaSource.perfisBruto)
            : 'Nao informado',
      },
      {
        key: 'perfis-liquidos',
        label: 'Perfis liquidos',
        value:
          propostaSource?.perfisLiquidos != null
            ? formatTechnicalMetricValue(propostaSource.perfisLiquidos)
            : 'Nao informado',
      },
      {
        key: 'vidro',
        label: 'Valor de vidro',
        value:
          propostaSource?.valorVidro != null
            ? formatCurrency(propostaSource.valorVidro)
            : 'Nao informado',
      },
      {
        key: 'acessorios',
        label: 'Valor de acessorios',
        value:
          propostaSource?.valorAcessorios != null
            ? formatCurrency(propostaSource.valorAcessorios)
            : 'Nao informado',
      },
    ],
    [
      formatCurrency,
      propostaSource?.areaM2,
      propostaSource?.perfisBruto,
      propostaSource?.perfisLiquidos,
      propostaSource?.valorAcessorios,
      propostaSource?.valorVidro,
    ]
  )
  const hasTechnicalMetrics = useMemo(
    () =>
      Boolean(
        propostaSource &&
          (
            propostaSource.areaM2 != null ||
            propostaSource.perfisBruto != null ||
            propostaSource.perfisLiquidos != null ||
            propostaSource.valorVidro != null ||
            propostaSource.valorAcessorios != null
          )
      ),
    [propostaSource]
  )
  const hasTechnicalNotes = Boolean(propostaSource?.observacoesTecnicas?.trim())
  const hasAnyTechnicalData = hasTechnicalMetrics || hasTechnicalNotes

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
      areaM2: propostaSource.areaM2 ?? null,
      perfisBruto: propostaSource.perfisBruto ?? null,
      perfisLiquidos: propostaSource.perfisLiquidos ?? null,
      valorPerfil: propostaSource.valorPerfil ?? null,
      valorVidro: propostaSource.valorVidro ?? null,
      valorAcessorios: propostaSource.valorAcessorios ?? null,
      observacoesTecnicas: propostaSource.observacoesTecnicas ?? null,
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

  const beginSubmit = () => {
    if (isSubmittingRef.current) return false
    isSubmittingRef.current = true
    setIsSubmitting(true)
    return true
  }

  const endSubmit = () => {
    isSubmittingRef.current = false
    setIsSubmitting(false)
  }

  const syncProposalSnapshot = async (proposalSnapshot: any) => {
    if (!propostaId || !proposalSnapshot) return
    const hasAttachmentDetails = Array.isArray(proposalSnapshot.anexos)
    const hasCommentDetails = Array.isArray(proposalSnapshot.comentarios)
    const postClosingSnapshot = {
      aguardandoContrato:
        proposalSnapshot.posFechamentoAguardandoContratoAt ??
        proposalSnapshot.pos_fechamento_aguardando_contrato_at,
      contratoFeito:
        proposalSnapshot.posFechamentoContratoFeitoAt ??
        proposalSnapshot.pos_fechamento_contrato_feito_at,
      contratoEnviado:
        proposalSnapshot.posFechamentoContratoEnviadoAt ??
        proposalSnapshot.pos_fechamento_contrato_enviado_at,
      contratoAssinado:
        proposalSnapshot.posFechamentoContratoAssinadoAt ??
        proposalSnapshot.pos_fechamento_contrato_assinado_at,
      aguardandoPagamento:
        proposalSnapshot.posFechamentoAguardandoPagamentoAt ??
        proposalSnapshot.pos_fechamento_aguardando_pagamento_at,
      pagamentoConfirmado:
        proposalSnapshot.posFechamentoPagamentoConfirmadoAt ??
        proposalSnapshot.pos_fechamento_pagamento_confirmado_at,
      aguardandoOs:
        proposalSnapshot.posFechamentoAguardandoOsAt ??
        proposalSnapshot.pos_fechamento_aguardando_os_at,
      liberadaProducao:
        proposalSnapshot.posFechamentoOrdemServicoLiberadaAt ??
        proposalSnapshot.pos_fechamento_ordem_servico_liberada_at,
    }
    const proposalPatch: Record<string, unknown> = {
      ...proposalSnapshot,
      posFechamentoAguardandoContratoAt: postClosingSnapshot.aguardandoContrato,
      posFechamentoContratoFeitoAt: postClosingSnapshot.contratoFeito,
      posFechamentoContratoEnviadoAt: postClosingSnapshot.contratoEnviado,
      posFechamentoContratoAssinadoAt: postClosingSnapshot.contratoAssinado,
      posFechamentoAguardandoPagamentoAt: postClosingSnapshot.aguardandoPagamento,
      posFechamentoPagamentoConfirmadoAt: postClosingSnapshot.pagamentoConfirmado,
      posFechamentoAguardandoOsAt: postClosingSnapshot.aguardandoOs,
      posFechamentoOrdemServicoLiberadaAt: postClosingSnapshot.liberadaProducao,
    }
    const proposalCollectionPatch: Record<string, unknown> = compactSnapshot({
      id: proposalSnapshot.id,
      clienteId: proposalSnapshot.clienteId,
      cliente_id: proposalSnapshot.clienteId,
      clienteNome: proposalSnapshot.clienteNome,
      cliente_nome: proposalSnapshot.clienteNome,
      numero: proposalSnapshot.numero,
      titulo: proposalSnapshot.titulo,
      materialTag: proposalSnapshot.materialTag,
      material_tag: proposalSnapshot.materialTag,
      areaM2: proposalSnapshot.areaM2,
      area_m2: proposalSnapshot.areaM2,
      perfisBruto: proposalSnapshot.perfisBruto,
      perfis_bruto: proposalSnapshot.perfisBruto,
      perfisLiquidos: proposalSnapshot.perfisLiquidos,
      perfis_liquidos: proposalSnapshot.perfisLiquidos,
      valorPerfil: proposalSnapshot.valorPerfil,
      valor_perfil: proposalSnapshot.valorPerfil,
      valorVidro: proposalSnapshot.valorVidro,
      valor_vidro: proposalSnapshot.valorVidro,
      valorAcessorios: proposalSnapshot.valorAcessorios,
      valor_acessorios: proposalSnapshot.valorAcessorios,
      observacoesTecnicas: proposalSnapshot.observacoesTecnicas,
      observacoes_tecnicas: proposalSnapshot.observacoesTecnicas,
      kanbanOrder: proposalSnapshot.kanbanOrder,
      kanban_order: proposalSnapshot.kanbanOrder,
      valor: proposalSnapshot.valor,
      descricao: proposalSnapshot.descricao,
      status: proposalSnapshot.status,
      responsavelId: proposalSnapshot.responsavelId,
      responsavel_id: proposalSnapshot.responsavelId,
      responsavelNome: proposalSnapshot.responsavelNome,
      responsavel_nome: proposalSnapshot.responsavelNome,
      orcamentistaId: proposalSnapshot.orcamentistaId,
      orcamentista_id: proposalSnapshot.orcamentistaId,
      orcamentistaNome: proposalSnapshot.orcamentistaNome,
      orcamentista_nome: proposalSnapshot.orcamentistaNome,
      retificacoesCount: proposalSnapshot.retificacoesCount,
      retificacoes_count: proposalSnapshot.retificacoesCount,
      followUpBaseAt: proposalSnapshot.followUpBaseAt,
      follow_up_base_at: proposalSnapshot.followUpBaseAt,
      followUpTime: proposalSnapshot.followUpTime,
      follow_up_time: proposalSnapshot.followUpTime,
      posFechamentoAguardandoContratoAt: postClosingSnapshot.aguardandoContrato,
      pos_fechamento_aguardando_contrato_at: postClosingSnapshot.aguardandoContrato,
      posFechamentoContratoFeitoAt: postClosingSnapshot.contratoFeito,
      pos_fechamento_contrato_feito_at: postClosingSnapshot.contratoFeito,
      posFechamentoContratoEnviadoAt: postClosingSnapshot.contratoEnviado,
      pos_fechamento_contrato_enviado_at: postClosingSnapshot.contratoEnviado,
      posFechamentoContratoAssinadoAt: postClosingSnapshot.contratoAssinado,
      pos_fechamento_contrato_assinado_at: postClosingSnapshot.contratoAssinado,
      posFechamentoAguardandoPagamentoAt: postClosingSnapshot.aguardandoPagamento,
      pos_fechamento_aguardando_pagamento_at: postClosingSnapshot.aguardandoPagamento,
      posFechamentoPagamentoConfirmadoAt: postClosingSnapshot.pagamentoConfirmado,
      pos_fechamento_pagamento_confirmado_at: postClosingSnapshot.pagamentoConfirmado,
      posFechamentoAguardandoOsAt: postClosingSnapshot.aguardandoOs,
      pos_fechamento_aguardando_os_at: postClosingSnapshot.aguardandoOs,
      posFechamentoOrdemServicoLiberadaAt: postClosingSnapshot.liberadaProducao,
      pos_fechamento_ordem_servico_liberada_at: postClosingSnapshot.liberadaProducao,
      dataEnvio: proposalSnapshot.dataEnvio,
      criadoEm: proposalSnapshot.criadoEm,
      updatedAt: proposalSnapshot.updatedAt,
      updated_at: proposalSnapshot.updatedAt,
    })

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
    if (!propostaId || !propostaSource || !beginSubmit()) return

    const parsedValue = parseCurrencyInput(editingValue)
    if (parsedValue === null || parsedValue < 0) {
      toast.error('Informe um valor valido para a proposta.')
      endSubmit()
      return
    }

    const payload = buildInlineUpdatePayload({ valor: parsedValue })
    if (!payload) {
      endSubmit()
      return
    }

    try {
      const updatedProposal = await updateProposta(propostaId, payload)
      setIsEditingValue(false)
      await syncProposalSnapshot(updatedProposal)
      toast.success('Valor da proposta atualizado.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar valor da proposta.')
    } finally {
      endSubmit()
    }
  }

  const handleSaveDescription = async () => {
    if (!propostaId || !propostaSource || !beginSubmit()) return

    const payload = buildInlineUpdatePayload({ descricao: editingDescription })
    if (!payload) {
      endSubmit()
      return
    }

    try {
      const updatedProposal = await updateProposta(propostaId, payload)
      setIsEditingDescription(false)
      await syncProposalSnapshot(updatedProposal)
      toast.success('Descricao da proposta atualizada.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar descricao da proposta.')
    } finally {
      endSubmit()
    }
  }

  const handleSaveResponsavel = async () => {
    if (!propostaId || !propostaSource || !beginSubmit()) return

    if (!editingResponsavelId) {
      toast.error('Selecione um vendedor responsavel para continuar.')
      endSubmit()
      return
    }

    const responsavelSelecionado = availableResponsaveis.find(
      (usuario) => usuario.id === editingResponsavelId
    )

    if (!responsavelSelecionado) {
      toast.error('Nao foi possivel localizar o vendedor selecionado.')
      endSubmit()
      return
    }

    const payload = buildInlineUpdatePayload({ responsavelId: editingResponsavelId })
    if (!payload) {
      endSubmit()
      return
    }

    try {
      const updatedProposal = await updateProposta(propostaId, payload)
      const updatedProposalSnapshot =
        typeof updatedProposal === 'object' && updatedProposal !== null
          ? { ...(updatedProposal as Record<string, unknown>) }
          : {}
      setIsEditingResponsavel(false)
      await syncProposalSnapshot({
        ...updatedProposalSnapshot,
        responsavelId: editingResponsavelId,
        responsavelNome: responsavelSelecionado.nome,
      })
      toast.success('Vendedor responsavel atualizado.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar vendedor responsavel.')
    } finally {
      endSubmit()
    }
  }

  const resetTechnicalEditingState = () => {
    setIsEditingTechnicalDetails(false)
    setEditingAreaM2(
      propostaSource?.areaM2 != null ? formatTechnicalMetricValue(propostaSource.areaM2) : ''
    )
    setEditingPerfisBruto(
      propostaSource?.perfisBruto != null ? formatTechnicalMetricValue(propostaSource.perfisBruto) : ''
    )
    setEditingPerfisLiquidos(
      propostaSource?.perfisLiquidos != null ? formatTechnicalMetricValue(propostaSource.perfisLiquidos) : ''
    )
    setEditingValorVidro(
      propostaSource?.valorVidro != null ? formatCurrencyInputValue(propostaSource.valorVidro) : ''
    )
    setEditingValorAcessorios(
      propostaSource?.valorAcessorios != null ? formatCurrencyInputValue(propostaSource.valorAcessorios) : ''
    )
    setEditingObservacoesTecnicas(propostaSource?.observacoesTecnicas || '')
  }

  const handleSaveTechnicalDetails = async () => {
    if (!propostaId || !propostaSource || !beginSubmit()) return

    const areaM2 = parseOptionalNumericInput(editingAreaM2)
    const perfisBruto = parseOptionalNumericInput(editingPerfisBruto)
    const perfisLiquidos = parseOptionalNumericInput(editingPerfisLiquidos)
    const valorVidro = parseOptionalNumericInput(editingValorVidro)
    const valorAcessorios = parseOptionalNumericInput(editingValorAcessorios)

    const invalidTechnicalValue =
      (editingAreaM2.trim() && (areaM2 === null || areaM2 < 0)) ||
      (editingPerfisBruto.trim() && (perfisBruto === null || perfisBruto < 0)) ||
      (editingPerfisLiquidos.trim() && (perfisLiquidos === null || perfisLiquidos < 0)) ||
      (editingValorVidro.trim() && (valorVidro === null || valorVidro < 0)) ||
      (editingValorAcessorios.trim() && (valorAcessorios === null || valorAcessorios < 0))

    if (invalidTechnicalValue) {
      toast.error('Revise os dados tecnicos e informe apenas numeros validos.')
      endSubmit()
      return
    }

    const payload = buildInlineUpdatePayload({
      areaM2,
      perfisBruto,
      perfisLiquidos,
      valorVidro,
      valorAcessorios,
      observacoesTecnicas: editingObservacoesTecnicas.trim() || null,
    })
    if (!payload) {
      endSubmit()
      return
    }

    try {
      const updatedProposal = await updateProposta(propostaId, payload)
      setIsEditingTechnicalDetails(false)
      await syncProposalSnapshot(updatedProposal)
      toast.success('Dados tecnicos atualizados.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar dados tecnicos.')
    } finally {
      endSubmit()
    }
  }

  const handleSetPostClosingStep = async (step: PosFechamentoEtapa) => {
    if (!propostaId || !propostaSource || !canManagePostClosingSteps || !beginSubmit()) return

    const now = new Date().toISOString()
    const field = postClosingDateFields[step]
    const isCompleted = Boolean(propostaSource[field])
    const payload: InlineProposalUpdatePayload = {}
    payload[field] = isCompleted ? null : now

    try {
      const updatedProposal = await updateProposta(propostaId, buildInlineUpdatePayload(payload) || payload)
      await syncProposalSnapshot(updatedProposal)
      toast.success('Etapa de pos-fechamento atualizada.')
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar pos-fechamento.')
    } finally {
      endSubmit()
    }
  }

  const startEditingTechnicalDetails = () => {
    if (!canEditTechnicalDetails) return
    setIsEditingTechnicalDetails(true)
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

  const handleSelectAttachments = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''

    if (!propostaId || !selectedFiles.length) {
      return
    }

    setIsSubmitting(true)
    try {
      const updatedProposal = await updateProposta(propostaId, {
        anexos: selectedFiles as unknown as Proposta['anexos'],
      })
      await syncProposalSnapshot(updatedProposal)
      toast.success(
        selectedFiles.length === 1 ? 'Anexo enviado com sucesso.' : 'Anexos enviados com sucesso.'
      )
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao enviar os anexos da proposta.')
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

                {shouldShowPostClosing ? (
                  <div className="min-w-0 space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Pos-fechamento</p>
                        <p className="text-sm text-muted-foreground">
                          Acompanhe contrato, pagamento e liberacao da ordem de servico.
                        </p>
                      </div>
                      <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/15 text-cyan-200">
                        {currentPostClosingLabel}
                      </Badge>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {posFechamentoEtapas.map((step) => {
                        const completed = isPostClosingStepCompleted(propostaSource, step)
                        const Icon = completed ? CheckCircle2 : Circle
                        const stepContent = (
                          <>
                            <Icon className={`h-4 w-4 shrink-0 ${completed ? 'text-cyan-300' : 'text-muted-foreground'}`} />
                            <span className="min-w-0 text-sm font-medium">
                              {posFechamentoEtapaLabels[step]}
                            </span>
                          </>
                        )

                        if (!canManagePostClosingSteps) {
                          return (
                            <div
                              key={step}
                              className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left ${
                                completed
                                  ? 'border-cyan-500/35 bg-cyan-500/15 text-foreground'
                                  : 'border-border bg-secondary/10 text-muted-foreground'
                              }`}
                            >
                              {stepContent}
                            </div>
                          )
                        }

                        return (
                          <button
                            key={step}
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => void handleSetPostClosingStep(step)}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                              completed
                                ? 'border-cyan-500/35 bg-cyan-500/15 text-foreground'
                                : 'border-border bg-secondary/10 text-muted-foreground'
                            } hover:border-cyan-500/50 hover:bg-cyan-500/10`}
                          >
                            {stepContent}
                          </button>
                        )
                      })}
                    </div>

                    {!canManagePostClosingSteps ? (
                      <p className="text-xs text-muted-foreground">
                        Voce pode acompanhar esta etapa, mas a marcacao dos checks depende de permissao liberada pelo ADM.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {canViewTechnicalDetails ? (
                  <div className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4">
                    <div
                      className={`flex items-start justify-between gap-3 ${canEditTechnicalDetails && !isEditingTechnicalDetails ? 'cursor-text' : ''}`}
                      onClick={() => {
                        if (!isEditingTechnicalDetails) {
                          startEditingTechnicalDetails()
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Dados tecnicos da obra</p>
                        <p className="text-sm text-muted-foreground">
                          Resumo interno para aprovacao e leitura tecnica da proposta.
                        </p>
                      </div>
                      {canEditTechnicalDetails && !isEditingTechnicalDetails ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </span>
                      ) : null}
                    </div>

                    {isEditingTechnicalDetails ? (
                      <div className="space-y-4 rounded-xl border border-border/70 bg-secondary/10 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Area (m2)</label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingAreaM2}
                              onChange={(event) => setEditingAreaM2(event.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Perfis bruto</label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingPerfisBruto}
                              onChange={(event) => setEditingPerfisBruto(event.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Perfis liquidos</label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingPerfisLiquidos}
                              onChange={(event) => setEditingPerfisLiquidos(event.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Valor de vidro</label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingValorVidro}
                              onChange={(event) => setEditingValorVidro(event.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Valor de acessorios</label>
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingValorAcessorios}
                              onChange={(event) => setEditingValorAcessorios(event.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">Observacoes tecnicas</label>
                          <Textarea
                            rows={5}
                            value={editingObservacoesTecnicas}
                            onChange={(event) => setEditingObservacoesTecnicas(event.target.value)}
                            placeholder="Detalhes tecnicos complementares da obra..."
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={resetTechnicalEditingState}
                            disabled={isSubmitting}
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void handleSaveTechnicalDetails()}
                            disabled={isSubmitting}
                          >
                            Salvar dados tecnicos
                          </Button>
                        </div>
                      </div>
                    ) : hasAnyTechnicalData ? (
                      <div
                        className={`space-y-3 ${canEditTechnicalDetails ? 'cursor-text' : ''}`}
                        onClick={startEditingTechnicalDetails}
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          {technicalMetrics.map((metric) => (
                            <div
                              key={metric.key}
                              className={`rounded-xl border border-border bg-secondary/10 px-4 py-3.5 ${canEditTechnicalDetails ? 'transition hover:bg-secondary/20' : ''}`}
                            >
                              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                {metric.label}
                              </p>
                              <p className="mt-3 text-base font-semibold leading-tight text-foreground [font-variant-numeric:tabular-nums]">
                                {metric.value}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div
                          className={`rounded-xl border border-border bg-secondary/10 px-4 py-3.5 text-left ${canEditTechnicalDetails ? 'transition hover:bg-secondary/20' : ''}`}
                        >
                          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Observacoes tecnicas
                          </p>
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                            {propostaSource.observacoesTecnicas?.trim() ||
                              'Nenhuma observacao tecnica foi registrada.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl border border-dashed border-border bg-secondary/10 px-4 py-4 text-left ${canEditTechnicalDetails ? 'cursor-text transition hover:bg-secondary/20' : ''}`}
                        onClick={startEditingTechnicalDetails}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              Nenhum dado tecnico foi preenchido ainda.
                            </p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              Quando o orcamentista finalizar a proposta, este bloco pode receber area, custos tecnicos e observacoes para a aprovacao.
                            </p>
                          </div>
                          {canEditTechnicalDetails ? (
                            <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Vendedor Responsavel
                        </p>
                        {isEditingResponsavel ? (
                          <div className="mt-3 space-y-3">
                            <Select
                              value={editingResponsavelId}
                              onValueChange={setEditingResponsavelId}
                              disabled={isSubmitting}
                            >
                              <SelectTrigger className="h-11 border-border/80 bg-secondary/10">
                                <SelectValue placeholder="Selecione o vendedor responsavel" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableResponsaveis.map((usuario) => (
                                  <SelectItem key={usuario.id} value={usuario.id}>
                                    {usuario.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setIsEditingResponsavel(false)
                                  setEditingResponsavelId(propostaSource.responsavelId || '')
                                }}
                                disabled={isSubmitting}
                              >
                                Cancelar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleSaveResponsavel()}
                                disabled={isSubmitting || !editingResponsavelId}
                              >
                                Salvar vendedor
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={`mt-2 w-full rounded-lg text-left ${canEditResponsavel ? 'transition hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background' : 'cursor-default'}`}
                            onClick={() => {
                              if (!canEditResponsavel) return
                              setEditingResponsavelId(propostaSource.responsavelId || '')
                              setIsEditingResponsavel(true)
                            }}
                            disabled={!canEditResponsavel}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-words text-base font-semibold text-foreground">
                                  {propostaSource.responsavelNome || '-'}
                                </p>
                                <p className="mt-1 break-words text-sm text-muted-foreground">
                                  Responsavel comercial
                                </p>
                              </div>
                              {canEditResponsavel ? (
                                <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : null}
                            </div>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      Anexos
                    </div>
                    {canManageProposalContent ? (
                      <>
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => void handleSelectAttachments(event)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={isSubmitting}
                        >
                          Adicionar anexo
                        </Button>
                      </>
                    ) : null}
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
                            {canManageProposalContent &&
                              (user?.role === 'admin' ||
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
                        canManageProposalComments &&
                        (
                          user?.role === 'admin' ||
                          user?.role === 'gerente' ||
                          item.usuarioId === user?.id
                        )

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

              {canManageProposalComments ? (
                <>
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
                </>
              ) : user?.role === 'vendedor' ? (
                <>
                  <Separator />
                  <div className="min-w-0 px-4 py-4 text-sm text-muted-foreground">
                    {hasRuleAccess(user, 'allowSellerCommentsOnResponsibleProposals')
                      ? 'O vendedor pode comentar nesta proposta, mas nao pode alterar valor, anexos ou qualquer outra informacao. Para isso, envie a proposta para retificacao no funil com a justificativa obrigatoria.'
                      : 'Os comentarios desta proposta tambem estao bloqueados para este vendedor. Se precisar intervir, use o fluxo de retificacao definido para o time.'}
                  </div>
                </>
              ) : null}
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
