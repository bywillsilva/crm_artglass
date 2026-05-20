import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { deleteStoredFiles, persistSavedProposalFiles, saveProposalFiles } from '@/lib/server/proposal-files'
import { syncProposalServices } from '@/lib/server/proposal-services'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { statusPropostaLabels } from '@/lib/data/types'
import { notifyProposalEmail } from '@/lib/server/email-notifications'
import { jsonNoStore } from '@/lib/server/http-cache'
import { normalizeJsonPayload } from '@/lib/server/json-normalize'
import { ensureProposalReadSideReady } from '@/lib/server/read-side-maintenance'
import {
  canOrcamentistaAccessProposal,
  canOrcamentistaViewProposal,
  formatDateTime,
  normalizeProposalStatus,
  parseDatabaseDateTime,
  requiresOrcamentistaAssignment,
  requiresPositiveProposalValue,
  setProposalKanbanPosition,
  syncProposalAutomation,
  type ProposalWorkflowStatus,
} from '@/lib/server/proposal-workflow'
import {
  getClientDocumentLabel,
  inferClientType,
  isValidClientDocument,
} from '@/lib/utils/client-document'

const PROPOSTA_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.PROPOSTA_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

const PROPOSAL_SHARED_SELECT_COLUMNS = `
  p.id,
  p.numero,
  p.cliente_id,
  p.responsavel_id,
  p.orcamentista_id,
  p.retificacoes_count,
  p.titulo,
  p.material_tag,
`

const PROPOSAL_TECHNICAL_SELECT_COLUMNS = `
  p.area_m2,
  p.perfis_bruto,
  p.perfis_liquidos,
  p.valor_perfil,
  p.valor_vidro,
  p.valor_acessorios,
  p.observacoes_tecnicas,
`

const PROPOSAL_TECHNICAL_FALLBACK_SELECT_COLUMNS = `
  NULL as area_m2,
  NULL as perfis_bruto,
  NULL as perfis_liquidos,
  NULL as valor_perfil,
  NULL as valor_vidro,
  NULL as valor_acessorios,
  NULL as observacoes_tecnicas,
`

const PROPOSAL_BASE_SELECT_COLUMNS = `
  ${PROPOSAL_SHARED_SELECT_COLUMNS}
  ${PROPOSAL_TECHNICAL_SELECT_COLUMNS}
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.servicos,
  p.condicoes,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  p.pos_fechamento_aguardando_contrato_at,
  p.pos_fechamento_contrato_feito_at,
  p.pos_fechamento_contrato_enviado_at,
  p.pos_fechamento_contrato_assinado_at,
  p.pos_fechamento_aguardando_pagamento_at,
  p.pos_fechamento_pagamento_confirmado_at,
  p.pos_fechamento_aguardando_os_at,
  p.pos_fechamento_ordem_servico_liberada_at,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome
`

const PROPOSAL_BASE_SELECT_COLUMNS_LEGACY = `
  ${PROPOSAL_SHARED_SELECT_COLUMNS}
  ${PROPOSAL_TECHNICAL_FALLBACK_SELECT_COLUMNS}
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.servicos,
  p.condicoes,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  NULL as pos_fechamento_aguardando_contrato_at,
  NULL as pos_fechamento_contrato_feito_at,
  NULL as pos_fechamento_contrato_enviado_at,
  NULL as pos_fechamento_contrato_assinado_at,
  NULL as pos_fechamento_aguardando_pagamento_at,
  NULL as pos_fechamento_pagamento_confirmado_at,
  NULL as pos_fechamento_aguardando_os_at,
  NULL as pos_fechamento_ordem_servico_liberada_at,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome
`

type ProposalPayload = {
  titulo?: string
  materialTag?: string | null
  areaM2?: number | null
  perfisBruto?: number | null
  perfisLiquidos?: number | null
  valorPerfil?: number | null
  valorVidro?: number | null
  valorAcessorios?: number | null
  observacoesTecnicas?: string | null
  descricao?: string
  valor?: number | null
  desconto?: number | null
  status?: string
  validade?: string | null
  servicos?: unknown[]
  condicoes?: string | null
  responsavelId?: string | null
  orcamentistaId?: string | null
  comentario?: string | null
  justificativa?: string | null
  workflowAction?: string | null
  followUpTime?: string | null
  clienteId?: string
  clienteTipo?: 'residencial' | 'comercial' | null
  clienteNome?: string | null
  clienteCpf?: string | null
  clienteTelefone?: string | null
  clienteEmail?: string | null
  clienteEndereco?: string | null
  clienteNumero?: string | null
  clienteBairro?: string | null
  clienteCidade?: string | null
  clienteEstado?: string | null
  clienteCep?: string | null
  clienteValorFechado?: number | null
  kanbanPosition?: number | null
  posFechamentoAguardandoContratoAt?: string | null
  posFechamentoContratoFeitoAt?: string | null
  posFechamentoContratoEnviadoAt?: string | null
  posFechamentoContratoAssinadoAt?: string | null
  posFechamentoAguardandoPagamentoAt?: string | null
  posFechamentoPagamentoConfirmadoAt?: string | null
  posFechamentoAguardandoOsAt?: string | null
  posFechamentoOrdemServicoLiberadaAt?: string | null
  anexos: File[]
}

type ProposalAttachmentRecord = {
  id: string
  nome_original: string | null
  tipo_mime: string | null
}

type ProposalDetailAttachment = {
  id: string
  usuario_id: string | null
  nome_original: string | null
  tipo_mime: string | null
  tamanho: number | null
  created_at: string | null
  url: string
}

type SellerWorkflowAction =
  | 'enviado_ao_cliente'
  | 'follow_up_1_dia'
  | 'follow_up_3_dias'
  | 'follow_up_7_dias'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'
  | 'stand_by'

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isPdfAttachmentRecord(anexo: ProposalAttachmentRecord) {
  return (
    anexo.tipo_mime === 'application/pdf' ||
    String(anexo.nome_original || '').toLowerCase().endsWith('.pdf')
  )
}

const SELLER_VISIBLE_STATUSES: ProposalWorkflowStatus[] = [
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'aguardando_follow_up_3_dias',
  'follow_up_3_dias',
  'aguardando_follow_up_7_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'pos_fechamento',
  'perdido',
]

const SELLER_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  enviar_ao_cliente: ['enviado_ao_cliente'],
  enviado_ao_cliente: ['follow_up_1_dia', 'em_retificacao', 'perdido', 'fechado'],
  follow_up_1_dia: ['aguardando_follow_up_3_dias', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_3_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_3_dias: ['follow_up_1_dia', 'aguardando_follow_up_7_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  stand_by: ['stand_by', 'enviar_ao_cliente', 'enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
  fechado: ['pos_fechamento', 'em_retificacao'],
  pos_fechamento: ['enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'em_retificacao', 'fechado', 'perdido'],
  perdido: ['em_retificacao'],
}

const ORCAMENTISTA_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  novo_cliente: ['em_orcamento'],
  em_orcamento: ['novo_cliente', 'aguardando_aprovacao', 'em_retificacao'],
  em_retificacao: ['aguardando_aprovacao', 'em_orcamento'],
}

const WORKFLOW_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  novo_cliente: ['em_orcamento'],
  em_orcamento: ['novo_cliente', 'aguardando_aprovacao', 'em_retificacao'],
  em_retificacao: ['aguardando_aprovacao', 'em_orcamento'],
  aguardando_aprovacao: [
    'enviar_ao_cliente',
    'follow_up_1_dia',
    'follow_up_3_dias',
    'follow_up_7_dias',
    'em_retificacao',
  ],
  enviar_ao_cliente: ['enviado_ao_cliente', 'aguardando_aprovacao', 'em_retificacao', 'em_orcamento'],
  enviado_ao_cliente: ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao'],
  follow_up_1_dia: ['follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_3_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_3_dias: ['follow_up_1_dia', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  stand_by: ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
  fechado: ['pos_fechamento', 'enviado_ao_cliente', 'em_retificacao'],
  pos_fechamento: ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao', 'enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido'],
  perdido: ['enviado_ao_cliente', 'em_retificacao'],
}

async function ensureBaseSchema() {
  await ensureProposalReadSideReady()
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== 'string') {
    return value == null ? null : String(value)
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeMaterialTag(value: unknown) {
  const normalized = normalizeNullableText(value)
  return normalized ? normalized.slice(0, 80) : null
}

function parseNullableNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (value && typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function') {
    const serialized = (value as { toString: () => string }).toString()
    if (serialized && serialized !== '[object Object]') {
      return parseNullableNumber(serialized)
    }
  }

  return null
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = parseNullableNumber(value)
    if (parsed != null && parsed > 0) {
      return parsed
    }
  }

  return null
}

function resolveSafeProposalValue(params: {
  requestedClosedValue: number | null
  requestedProposalValue: number | null
  existingProposalValue: number | null
  existingFinalValue: number | null
}) {
  const existingPositiveValue = firstPositiveNumber(
    params.existingProposalValue,
    params.existingFinalValue
  )

  if (params.requestedClosedValue != null && params.requestedClosedValue > 0) {
    return params.requestedClosedValue
  }

  if (params.requestedProposalValue != null && params.requestedProposalValue > 0) {
    return params.requestedProposalValue
  }

  // Nunca troca um valor positivo salvo por zero/null enviado por snapshot incompleto.
  if (existingPositiveValue != null) {
    return existingPositiveValue
  }

  return params.requestedClosedValue ?? params.requestedProposalValue ?? params.existingProposalValue ?? params.existingFinalValue ?? 0
}

function parseOptionalDateTime(value: unknown) {
  if (value == null || value === '') {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function serializeDateTimeForDatabase(value: Date | null) {
  return value ? formatDateTime(value) : null
}

function isUnknownColumnError(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  const message =
    typeof error === 'object' && error && 'sqlMessage' in error
      ? String((error as any).sqlMessage || '')
      : typeof error === 'object' && error && 'message' in error
        ? String((error as any).message || '')
        : ''

  return code === 'ER_BAD_FIELD_ERROR' || /unknown column/i.test(message)
}

function hasExplicitAssigneeId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function canViewTechnicalProposalData(user: any) {
  return hasRuleAccess(user, 'canViewTechnicalProposalData')
}

function sanitizeTechnicalProposalData<T extends Record<string, any>>(proposal: T, user: any): T {
  if (canViewTechnicalProposalData(user)) {
    return proposal
  }

  const sanitized = { ...proposal }
  delete sanitized.area_m2
  delete sanitized.areaM2
  delete sanitized.perfis_bruto
  delete sanitized.perfisBruto
  delete sanitized.perfis_liquidos
  delete sanitized.perfisLiquidos
  delete sanitized.valor_perfil
  delete sanitized.valorPerfil
  delete sanitized.valor_vidro
  delete sanitized.valorVidro
  delete sanitized.valor_acessorios
  delete sanitized.valorAcessorios
  delete sanitized.observacoes_tecnicas
  delete sanitized.observacoesTecnicas
  return sanitized
}

function parseKanbanPosition(value: unknown) {
  const parsed = parseNullableNumber(value)
  if (parsed == null) {
    return null
  }

  return Math.max(0, Math.trunc(parsed))
}

const FOLLOW_UP_STAGE_DAY_OFFSETS: Partial<Record<ProposalWorkflowStatus, number>> = {
  enviado_ao_cliente: 0,
  follow_up_1_dia: 1,
  aguardando_follow_up_3_dias: 3,
  follow_up_3_dias: 3,
  aguardando_follow_up_7_dias: 7,
  follow_up_7_dias: 7,
}

function getFollowUpStageDayOffset(status: ProposalWorkflowStatus) {
  return FOLLOW_UP_STAGE_DAY_OFFSETS[status] ?? null
}

function resolveFollowUpBaseAt(params: {
  previousStatus: ProposalWorkflowStatus
  nextStatus: ProposalWorkflowStatus
  changedAt: Date
  currentFollowUpBaseAt: Date | null
}) {
  const { previousStatus, nextStatus, changedAt, currentFollowUpBaseAt } = params
  const previousOffset = getFollowUpStageDayOffset(previousStatus)
  const nextOffset = getFollowUpStageDayOffset(nextStatus)

  if (nextStatus === 'enviado_ao_cliente') {
    return changedAt
  }

  if (nextOffset == null) {
    return currentFollowUpBaseAt
  }

  if (previousStatus === nextStatus && currentFollowUpBaseAt) {
    return currentFollowUpBaseAt
  }

  if (currentFollowUpBaseAt && previousOffset != null && previousOffset === nextOffset) {
    return currentFollowUpBaseAt
  }

  if (previousOffset != null && previousOffset < nextOffset) {
    const adjustedBaseAt = new Date(changedAt)
    adjustedBaseAt.setDate(adjustedBaseAt.getDate() - previousOffset)
    return adjustedBaseAt
  }

  return changedAt
}

function formatFollowUpTimeFromDate(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function isSellerVisibleStatus(status: ProposalWorkflowStatus) {
  return SELLER_VISIBLE_STATUSES.includes(status)
}

function resolveSellerWorkflowStatus(
  currentStatus: ProposalWorkflowStatus,
  action: SellerWorkflowAction
): ProposalWorkflowStatus {
  if (action === 'enviado_ao_cliente') return 'enviado_ao_cliente'
  if (action === 'follow_up_1_dia') return 'follow_up_1_dia'
  if (action === 'follow_up_3_dias') return 'follow_up_3_dias'
  if (action === 'follow_up_7_dias') return 'follow_up_7_dias'
  if (action === 'em_retificacao') return 'em_retificacao'
  if (action === 'fechado') return 'fechado'
  if (action === 'perdido') return 'perdido'
  if (action === 'stand_by') return 'stand_by'

  return currentStatus
}

function isSellerWorkflowActionAllowed(
  currentStatus: ProposalWorkflowStatus,
  action: SellerWorkflowAction
) {
  const allowedActions: Partial<Record<ProposalWorkflowStatus, SellerWorkflowAction[]>> = {
    enviar_ao_cliente: ['enviado_ao_cliente'],
    enviado_ao_cliente: ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao'],
    follow_up_1_dia: ['follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
    aguardando_follow_up_3_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
    follow_up_3_dias: ['follow_up_1_dia', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
    aguardando_follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
    follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
    stand_by: ['fechado', 'perdido', 'em_retificacao', 'enviado_ao_cliente'],
    fechado: ['em_retificacao'],
    perdido: ['em_retificacao'],
  }

  return allowedActions[currentStatus]?.includes(action) ?? false
}

async function parseProposalPayload(request: NextRequest): Promise<ProposalPayload> {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const parseJsonValue = <T>(value: FormDataEntryValue | null, fallback: T) => {
      if (typeof value !== 'string' || !value.trim()) return fallback
      try {
        return JSON.parse(value) as T
      } catch {
        return fallback
      }
    }

    const hasField = (name: string) => formData.has(name)
    const getOptionalString = (name: string) =>
      hasField(name) ? String(formData.get(name) || '') || null : undefined
    const getOptionalNormalizedText = (name: string) =>
      hasField(name) ? normalizeNullableText(formData.get(name)) : undefined
    const getOptionalNumber = (name: string) =>
      hasField(name) ? parseNullableNumber(formData.get(name)) : undefined

      return {
        titulo: hasField('titulo') ? String(formData.get('titulo') || '') || undefined : undefined,
        materialTag: hasField('materialTag') ? normalizeMaterialTag(formData.get('materialTag')) : undefined,
        areaM2: getOptionalNumber('areaM2'),
        perfisBruto: getOptionalNumber('perfisBruto'),
        perfisLiquidos: getOptionalNumber('perfisLiquidos'),
        valorPerfil: getOptionalNumber('valorPerfil'),
        valorVidro: getOptionalNumber('valorVidro'),
        valorAcessorios: getOptionalNumber('valorAcessorios'),
        observacoesTecnicas: getOptionalNormalizedText('observacoesTecnicas'),
        descricao: hasField('descricao') ? String(formData.get('descricao') || '') || undefined : undefined,
        valor: getOptionalNumber('valor'),
        desconto: getOptionalNumber('desconto'),
      status: hasField('status') ? String(formData.get('status') || '') || undefined : undefined,
      validade: getOptionalString('validade'),
      servicos: hasField('servicos') ? parseJsonValue(formData.get('servicos'), [] as unknown[]) : undefined,
      condicoes: getOptionalString('condicoes'),
      responsavelId: getOptionalString('responsavelId'),
      orcamentistaId: getOptionalString('orcamentistaId'),
      comentario: getOptionalString('comentario'),
      justificativa: getOptionalString('justificativa'),
        workflowAction: getOptionalString('workflowAction'),
        followUpTime: getOptionalString('followUpTime'),
        kanbanPosition: hasField('kanbanPosition') ? parseKanbanPosition(formData.get('kanbanPosition')) : undefined,
        posFechamentoAguardandoContratoAt: getOptionalString('posFechamentoAguardandoContratoAt'),
        posFechamentoContratoFeitoAt: getOptionalString('posFechamentoContratoFeitoAt'),
        posFechamentoContratoEnviadoAt: getOptionalString('posFechamentoContratoEnviadoAt'),
        posFechamentoContratoAssinadoAt: getOptionalString('posFechamentoContratoAssinadoAt'),
        posFechamentoAguardandoPagamentoAt: getOptionalString('posFechamentoAguardandoPagamentoAt'),
        posFechamentoPagamentoConfirmadoAt: getOptionalString('posFechamentoPagamentoConfirmadoAt'),
        posFechamentoAguardandoOsAt: getOptionalString('posFechamentoAguardandoOsAt'),
        posFechamentoOrdemServicoLiberadaAt: getOptionalString('posFechamentoOrdemServicoLiberadaAt'),
        clienteId: hasField('clienteId') ? String(formData.get('clienteId') || '') || undefined : undefined,
      clienteTipo:
        !hasField('clienteTipo')
          ? undefined
          : formData.get('clienteTipo') === 'comercial' || formData.get('clienteTipo') === 'residencial'
            ? (String(formData.get('clienteTipo')) as 'residencial' | 'comercial')
            : null,
      clienteNome: getOptionalString('clienteNome'),
      clienteCpf: getOptionalString('clienteCpf'),
      clienteTelefone: getOptionalString('clienteTelefone'),
      clienteEmail: getOptionalString('clienteEmail'),
      clienteEndereco: getOptionalString('clienteEndereco'),
      clienteNumero: getOptionalString('clienteNumero'),
      clienteBairro: getOptionalString('clienteBairro'),
      clienteCidade: getOptionalString('clienteCidade'),
      clienteEstado: getOptionalString('clienteEstado'),
      clienteCep: getOptionalString('clienteCep'),
      clienteValorFechado: getOptionalNumber('clienteValorFechado'),
      anexos: formData
        .getAll('anexos')
        .filter((value): value is File => value instanceof File && value.size > 0),
    }
  }

  const data = await request.json()
  const hasOwnField = (field: string) => Object.prototype.hasOwnProperty.call(data, field)
  const getOptionalJsonNumber = (field: string) =>
    hasOwnField(field) ? parseNullableNumber(data[field]) : undefined
  const getOptionalJsonText = (field: string) =>
    hasOwnField(field) ? normalizeNullableText(data[field]) : undefined

  return {
    titulo: hasOwnField('titulo') ? data.titulo : undefined,
    materialTag: hasOwnField('materialTag') ? normalizeMaterialTag(data.materialTag) : undefined,
    areaM2: getOptionalJsonNumber('areaM2'),
    perfisBruto: getOptionalJsonNumber('perfisBruto'),
    perfisLiquidos: getOptionalJsonNumber('perfisLiquidos'),
    valorPerfil: getOptionalJsonNumber('valorPerfil'),
    valorVidro: getOptionalJsonNumber('valorVidro'),
    valorAcessorios: getOptionalJsonNumber('valorAcessorios'),
    observacoesTecnicas: getOptionalJsonText('observacoesTecnicas'),
    descricao: hasOwnField('descricao') ? data.descricao : undefined,
    valor: getOptionalJsonNumber('valor'),
    desconto: getOptionalJsonNumber('desconto'),
    status: hasOwnField('status') ? data.status : undefined,
    validade: hasOwnField('validade') ? data.validade || null : undefined,
    servicos: hasOwnField('servicos') && Array.isArray(data.servicos) ? data.servicos : undefined,
    condicoes: hasOwnField('condicoes') ? data.condicoes || null : undefined,
    responsavelId: hasOwnField('responsavelId') ? data.responsavelId || null : undefined,
    orcamentistaId: hasOwnField('orcamentistaId') ? data.orcamentistaId || null : undefined,
    comentario: hasOwnField('comentario') ? data.comentario || null : undefined,
    justificativa: hasOwnField('justificativa') ? data.justificativa || null : undefined,
    workflowAction: hasOwnField('workflowAction') ? data.workflowAction || null : undefined,
    followUpTime: hasOwnField('followUpTime') ? data.followUpTime || null : undefined,
    kanbanPosition: hasOwnField('kanbanPosition') ? parseKanbanPosition(data.kanbanPosition) : undefined,
    posFechamentoAguardandoContratoAt: hasOwnField('posFechamentoAguardandoContratoAt')
      ? data.posFechamentoAguardandoContratoAt || null
      : undefined,
    posFechamentoContratoFeitoAt: hasOwnField('posFechamentoContratoFeitoAt')
      ? data.posFechamentoContratoFeitoAt || null
      : undefined,
    posFechamentoContratoEnviadoAt: hasOwnField('posFechamentoContratoEnviadoAt')
      ? data.posFechamentoContratoEnviadoAt || null
      : undefined,
    posFechamentoContratoAssinadoAt: hasOwnField('posFechamentoContratoAssinadoAt')
      ? data.posFechamentoContratoAssinadoAt || null
      : undefined,
    posFechamentoAguardandoPagamentoAt: hasOwnField('posFechamentoAguardandoPagamentoAt')
      ? data.posFechamentoAguardandoPagamentoAt || null
      : undefined,
    posFechamentoPagamentoConfirmadoAt: hasOwnField('posFechamentoPagamentoConfirmadoAt')
      ? data.posFechamentoPagamentoConfirmadoAt || null
      : undefined,
    posFechamentoAguardandoOsAt: hasOwnField('posFechamentoAguardandoOsAt')
      ? data.posFechamentoAguardandoOsAt || null
      : undefined,
    posFechamentoOrdemServicoLiberadaAt: hasOwnField('posFechamentoOrdemServicoLiberadaAt')
      ? data.posFechamentoOrdemServicoLiberadaAt || null
      : undefined,
    clienteId: hasOwnField('clienteId') ? data.clienteId : undefined,
    clienteTipo:
      !hasOwnField('clienteTipo')
        ? undefined
        : data.clienteTipo === 'comercial' || data.clienteTipo === 'residencial'
          ? data.clienteTipo
          : null,
    clienteNome: hasOwnField('clienteNome') ? data.clienteNome || null : undefined,
    clienteCpf: hasOwnField('clienteCpf') ? data.clienteCpf || null : undefined,
    clienteTelefone: hasOwnField('clienteTelefone') ? data.clienteTelefone || null : undefined,
    clienteEmail: hasOwnField('clienteEmail') ? data.clienteEmail || null : undefined,
    clienteEndereco: hasOwnField('clienteEndereco') ? data.clienteEndereco || null : undefined,
    clienteNumero: hasOwnField('clienteNumero') ? data.clienteNumero || null : undefined,
    clienteBairro: hasOwnField('clienteBairro') ? data.clienteBairro || null : undefined,
    clienteCidade: hasOwnField('clienteCidade') ? data.clienteCidade || null : undefined,
    clienteEstado: hasOwnField('clienteEstado') ? data.clienteEstado || null : undefined,
    clienteCep: hasOwnField('clienteCep') ? data.clienteCep || null : undefined,
    clienteValorFechado: getOptionalJsonNumber('clienteValorFechado'),
    anexos: [],
  }
}

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

async function queryProposalByColumns(id: string, columns: string) {
  const [proposta] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${columns}
     FROM propostas p
     LEFT JOIN clientes c ON p.cliente_id = c.id
     LEFT JOIN usuarios u ON p.responsavel_id = u.id
     LEFT JOIN usuarios o ON p.orcamentista_id = o.id
     WHERE p.id = ?`,
    id
  )

  return proposta
}

async function getProposal(id: string) {
  try {
    return await queryProposalByColumns(id, PROPOSAL_BASE_SELECT_COLUMNS)
  } catch (error) {
    if (!isUnknownColumnError(error)) {
      throw error
    }

    try {
      await ensureSystemDatabaseSchema()
      return await queryProposalByColumns(id, PROPOSAL_BASE_SELECT_COLUMNS)
    } catch (schemaError) {
      if (!isUnknownColumnError(schemaError)) {
        throw schemaError
      }

      return queryProposalByColumns(id, PROPOSAL_BASE_SELECT_COLUMNS_LEGACY)
    }
  }
}

async function getProposalAttachments(id: string) {
  return prisma.proposta_anexos.findMany({
    where: { proposta_id: id },
    select: {
      id: true,
      nome_original: true,
      tipo_mime: true,
    },
    orderBy: {
      created_at: 'desc',
    },
  })
}

async function getProposalDetailPayload(id: string, initialProposal?: any, user?: any) {
  const proposta = initialProposal ?? (await getProposal(id))
  if (!proposta) {
    return null
  }

  const [anexos, comentarios] = await Promise.all([
    prisma.$queryRawUnsafe<ProposalDetailAttachment[]>(
      `SELECT id, usuario_id, nome_original, tipo_mime, tamanho, created_at,
              CONCAT('/api/propostas/', proposta_id, '/anexos/', id) as url
       FROM proposta_anexos
       WHERE proposta_id = ?
       ORDER BY created_at DESC`,
      id
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.proposta_id = ?
       ORDER BY pc.created_at DESC`,
      id
    ),
  ])

    return sanitizeTechnicalProposalData({
      ...proposta,
      anexos,
      comentarios,
    }, user)
  }

function canViewProposal(user: any, proposta: any) {
  const status = normalizeProposalStatus(proposta.status)
  if (status === 'pos_fechamento' && !hasRuleAccess(user, 'canViewPostClosing')) {
    return user.role === 'admin'
  }

  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return (
      hasRuleAccess(user, 'allowSellerViewReleasedProposals') &&
      proposta.responsavel_id === user.id &&
      isSellerVisibleStatus(status)
    )
  }
  if (user.role === 'orcamentista') {
    if (canOrcamentistaAccessProposal(proposta, user.id)) {
      return true
    }

    return (
      hasRuleAccess(user, 'allowOrcamentistaViewAssignedProposalsOutsideScope') &&
      canOrcamentistaViewProposal(proposta, user.id)
    )
  }
  return false
}

function canEditProposal(user: any, proposta: any) {
  const status = normalizeProposalStatus(proposta.status)
  if (status === 'pos_fechamento' && !hasRuleAccess(user, 'canViewPostClosing')) {
    return user.role === 'admin'
  }

  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return (
      hasRuleAccess(user, 'allowSellerViewReleasedProposals') &&
      proposta.responsavel_id === user.id &&
      isSellerVisibleStatus(status)
    )
  }
  if (user.role === 'orcamentista') {
    if (canOrcamentistaAccessProposal(proposta, user.id)) {
      return true
    }

    return (
      hasRuleAccess(user, 'allowOrcamentistaEditAssignedProposalsOutsideScope') &&
      proposta.orcamentista_id === user.id
    )
  }
  return false
}

function isTransitionAllowed(user: any, currentStatus: ProposalWorkflowStatus, nextStatus: ProposalWorkflowStatus) {
  if (currentStatus === nextStatus) {
    return true
  }

  if (user.role === 'admin') {
    return true
  }

  if (user.role === 'gerente') {
    if (currentStatus === 'aguardando_aprovacao') {
      return nextStatus === 'em_retificacao'
    }

    if (currentStatus === 'enviar_ao_cliente') {
      return nextStatus === 'enviado_ao_cliente'
    }

    return WORKFLOW_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false
  }

  if (user.role === 'vendedor') {
    return SELLER_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false
  }

  if (user.role === 'orcamentista') {
    return ORCAMENTISTA_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false
  }

  return false
}

async function validateUserRole(id: string | null, allowedRoles: string[]) {
  if (!id) {
    return null
  }

  const user = await prisma.usuarios.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      ativo: true,
    },
  })

  if (!user || !user.ativo || !allowedRoles.includes(user.role)) {
    throw new Error('Usuario informado para a proposta e invalido.')
  }

  return user.id as string
}

async function persistProposalComment(propostaId: string, usuarioId: string, comentario: string) {
  const cleaned = comentario.trim()
  if (!cleaned) return

  await prisma.proposta_comentarios.create({
    data: {
      id: uuidv4(),
      proposta_id: propostaId,
      usuario_id: usuarioId,
      comentario: cleaned,
    },
  })
}

async function touchProposalUpdatedAt(propostaId: string) {
  await prisma.$executeRawUnsafe('UPDATE propostas SET updated_at = NOW() WHERE id = ?', propostaId)
}

function formatWorkflowComment(
  action: SellerWorkflowAction | null,
  nextStatus: ProposalWorkflowStatus,
  comentario: string | null
) {
  const cleaned = comentario?.trim()
  if (!cleaned) {
    return null
  }

  switch (action) {
    case 'em_retificacao':
      return `Retificacao\n${cleaned}`
    case 'perdido':
      return `Perdido\n${cleaned}`
    case 'stand_by':
      return `Stand-by\n${cleaned}`
    default:
      if (nextStatus === 'em_retificacao') {
        return `Retificacao\n${cleaned}`
      }
      if (nextStatus === 'perdido') {
        return `Perdido\n${cleaned}`
      }
      if (nextStatus === 'stand_by') {
        return `Stand-by\n${cleaned}`
      }
      return cleaned
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    const cacheKey = `proposta:detail:${user.id}:${user.role}:${id}`
    const cachedProposta = getRuntimeCache<any>(cacheKey)
    if (cachedProposta !== undefined) {
      return jsonNoStore(cachedProposta)
    }

    const proposta = await getProposal(id)

    if (!proposta) {
      return jsonNoStore({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canViewProposal(user, proposta)) {
      return jsonNoStore({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const payload = await getProposalDetailPayload(id, proposta, user)
    if (!payload) {
      return jsonNoStore({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    const normalizedPayload = normalizeJsonPayload(payload)
    setRuntimeCache(cacheKey, normalizedPayload, PROPOSTA_DETAIL_CACHE_TTL_MS)
    return jsonNoStore(normalizedPayload)
  } catch (error) {
    console.error('Erro ao buscar proposta:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedUser().catch(() => null)
      if (!user) {
        return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
      }

      const cacheKey = `proposta:detail:${user.id}:${user.role}:${id}`
      const cachedProposta = getRuntimeCache<any>(cacheKey)
      if (cachedProposta) {
        return jsonNoStore(cachedProposta, { status: 200 })
      }
    }

    return jsonNoStore({ error: 'Erro ao buscar proposta' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    const { id } = await params
    const data = await parseProposalPayload(request)
    const propostaAtual = await getProposal(id)

    if (!propostaAtual) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canEditProposal(user, propostaAtual)) {
      return NextResponse.json(
        { error: 'Voce nao tem permissao para editar esta proposta' },
        { status: 403 }
      )
    }

    const previousStatus = normalizeProposalStatus(propostaAtual.status)
    const workflowAction =
      user.role === 'vendedor' && data.workflowAction
        ? (data.workflowAction as SellerWorkflowAction)
        : null
    const nextStatus =
      user.role === 'vendedor' && workflowAction
        ? resolveSellerWorkflowStatus(previousStatus, workflowAction)
        : normalizeProposalStatus(data.status ?? propostaAtual.status)
    const mustValidateApprovalRequirements =
      ['orcamentista', 'admin', 'gerente'].includes(user.role) &&
      previousStatus !== 'aguardando_aprovacao' &&
      nextStatus === 'aguardando_aprovacao'
    const anexosAtuaisPromise =
      mustValidateApprovalRequirements
        ? getProposalAttachments(id)
        : Promise.resolve([] as ProposalAttachmentRecord[])
    const isStatusChange = nextStatus !== previousStatus
    const hasPostClosingStepUpdate =
      data.posFechamentoAguardandoContratoAt !== undefined ||
      data.posFechamentoContratoFeitoAt !== undefined ||
      data.posFechamentoContratoEnviadoAt !== undefined ||
      data.posFechamentoContratoAssinadoAt !== undefined ||
      data.posFechamentoAguardandoPagamentoAt !== undefined ||
      data.posFechamentoPagamentoConfirmadoAt !== undefined ||
      data.posFechamentoAguardandoOsAt !== undefined ||
      data.posFechamentoOrdemServicoLiberadaAt !== undefined
    const requireRetificationJustification = hasRuleAccess(user, 'requireRetificationJustification')
    const requireStandByJustification = hasRuleAccess(user, 'requireStandByJustification')
    const requireLostJustification = hasRuleAccess(user, 'requireLostJustification')
    const requireClosedClientData = hasRuleAccess(user, 'requireClosedClientData')
    const requireApprovalPdf = hasRuleAccess(user, 'requireApprovalPdf')
    const requireApprovalTechnicalData = hasRuleAccess(user, 'requireApprovalTechnicalData')
    const requireApprovalOrcamentista = hasRuleAccess(user, 'requireApprovalOrcamentista')
    const justificationText = normalizeNullableText(data.justificativa)
    const rawCommentText = normalizeNullableText(data.comentario) ?? justificationText
    const commentText = formatWorkflowComment(workflowAction, nextStatus, rawCommentText)
    const requiresReasonComment =
      isStatusChange &&
      (nextStatus === 'fechado' ||
        (nextStatus === 'perdido' && requireLostJustification) ||
        (nextStatus === 'stand_by' && requireStandByJustification) ||
        (nextStatus === 'em_retificacao' && requireRetificationJustification))

    if (
      user.role !== 'admin' &&
      isStatusChange &&
      nextStatus === 'pos_fechamento' &&
      previousStatus !== 'fechado'
    ) {
      return NextResponse.json(
        { error: 'A proposta so pode ir para pos-fechamento quando estiver na etapa Fechado.' },
        { status: 400 }
      )
    }

    if (!isTransitionAllowed(user, previousStatus, nextStatus)) {
      return NextResponse.json(
        { error: 'Voce nao pode mover esta proposta para a etapa selecionada.' },
        { status: 403 }
      )
    }

    if (
      user.role !== 'admin' &&
      isStatusChange &&
      nextStatus === 'pos_fechamento' &&
      !hasRuleAccess(user, 'canMoveProposalToPostClosing')
    ) {
      return NextResponse.json(
        { error: 'Este usuario nao pode mover propostas para pos-fechamento.' },
        { status: 403 }
      )
    }

    if (hasPostClosingStepUpdate && !hasRuleAccess(user, 'canManagePostClosingSteps')) {
      return NextResponse.json(
        { error: 'Este usuario nao pode marcar etapas de pos-fechamento.' },
        { status: 403 }
      )
    }

    if (user.role === 'vendedor') {
      if (!workflowAction) {
        return NextResponse.json(
          { error: 'Vendedores podem apenas atualizar status da proposta pelo funil.' },
          { status: 400 }
        )
      } else {
        if (!isSellerWorkflowActionAllowed(previousStatus, workflowAction)) {
          return NextResponse.json(
            { error: 'Esta acao nao esta disponivel para a etapa atual da proposta.' },
            { status: 400 }
          )
        }

        const requiresJustification =
          workflowAction === 'fechado' ||
          (workflowAction === 'perdido' && requireLostJustification) ||
          (workflowAction === 'stand_by' && requireStandByJustification) ||
          (workflowAction === 'em_retificacao' && requireRetificationJustification)

        if (requiresJustification && !justificationText) {
          return NextResponse.json(
            { error: 'Informe uma justificativa para concluir esta atualizacao.' },
            { status: 400 }
          )
        }

        if (
          ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(workflowAction) &&
          !data.followUpTime
        ) {
          return NextResponse.json(
            { error: 'Defina o horario do proximo follow-up antes de continuar.' },
            { status: 400 }
          )
        }
      }
    }

    if (
      previousStatus === 'aguardando_aprovacao' &&
      nextStatus === 'enviar_ao_cliente' &&
      !hasRuleAccess(user, 'canApproveReadyProposals')
    ) {
      return NextResponse.json(
        { error: 'Apenas administradores podem aprovar o orcamento pronto.' },
        { status: 403 }
      )
    }

    if (requiresReasonComment && !rawCommentText) {
      return NextResponse.json(
        { error: 'Informe um comentario ou justificativa para seguir com esta etapa da proposta.' },
        { status: 400 }
      )
    }

    const requiresFollowUpTime =
      isStatusChange &&
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(nextStatus)

    if (requiresFollowUpTime && !data.followUpTime) {
      return NextResponse.json(
        { error: 'Defina o horario do proximo follow-up antes de continuar.' },
        { status: 400 }
      )
    }

    const isWorkflowDrivenUpdate =
      Boolean(workflowAction) || isStatusChange || data.kanbanPosition !== undefined || hasPostClosingStepUpdate
    const requestedClienteId =
      data.clienteId === undefined || (isWorkflowDrivenUpdate && !data.clienteId)
        ? propostaAtual.cliente_id
        : data.clienteId
    const requestedResponsavelId =
      !hasExplicitAssigneeId(data.responsavelId) || (isWorkflowDrivenUpdate && !data.responsavelId)
        ? propostaAtual.responsavel_id
        : data.responsavelId
    const isResponsavelFieldChanging =
      hasExplicitAssigneeId(data.responsavelId) && data.responsavelId !== propostaAtual.responsavel_id

    if (
      isResponsavelFieldChanging &&
      !hasRuleAccess(user, 'canEditProposalResponsavelDirectly') &&
      !hasRuleAccess(user, 'canSelectProposalResponsavelOnForm')
    ) {
      return NextResponse.json(
        { error: 'Este usuario nao pode alterar o vendedor responsavel diretamente por esta tela.' },
        { status: 403 }
      )
    }

    const responsavelId =
      user.role === 'admin' || user.role === 'gerente' || user.role === 'orcamentista'
        ? await validateUserRole(requestedResponsavelId, ['vendedor', 'gerente'])
        : propostaAtual.responsavel_id
    const requestedOrcamentistaId =
      !hasExplicitAssigneeId(data.orcamentistaId) || (isWorkflowDrivenUpdate && !data.orcamentistaId)
        ? propostaAtual.orcamentista_id
        : data.orcamentistaId
    let orcamentistaId = await validateUserRole(requestedOrcamentistaId, ['orcamentista'])
    if (!orcamentistaId && user.role === 'orcamentista' && requiresOrcamentistaAssignment(nextStatus)) {
      orcamentistaId = user.id
    }
    const isOrcamentistaFieldChanging =
      hasExplicitAssigneeId(data.orcamentistaId) && data.orcamentistaId !== propostaAtual.orcamentista_id

    if (isOrcamentistaFieldChanging && !hasRuleAccess(user, 'canAssignProposalOrcamentistaOnForm')) {
      return NextResponse.json(
        { error: 'Este usuario nao pode alterar o orcamentista diretamente por esta tela.' },
        { status: 403 }
      )
    }

    if (isStatusChange && !workflowAction && !hasRuleAccess(user, 'canEditProposalStatusDirectly')) {
      return NextResponse.json(
        { error: 'Este usuario nao pode alterar o status diretamente por esta tela.' },
        { status: 403 }
      )
    }

    if (
      requireApprovalOrcamentista &&
      requiresOrcamentistaAssignment(nextStatus) &&
      !orcamentistaId &&
      (isStatusChange || isOrcamentistaFieldChanging)
    ) {
      return NextResponse.json(
        { error: 'Selecione um orcamentista para seguir com esta etapa da proposta.' },
        { status: 400 }
      )
    }

    const anexosAtuais = await anexosAtuaisPromise
    const hasExistingProposalPdf = anexosAtuais.some(isPdfAttachmentRecord)
    const hasNewProposalPdf = data.anexos.some(isPdfFile)

    const shouldPreserveTechnicalField = (value: unknown) =>
      isWorkflowDrivenUpdate || value === undefined
    const areaM2 =
      shouldPreserveTechnicalField(data.areaM2)
        ? parseNullableNumber(propostaAtual.area_m2)
        : parseNullableNumber(data.areaM2)
    const perfisBruto =
      shouldPreserveTechnicalField(data.perfisBruto)
        ? parseNullableNumber(propostaAtual.perfis_bruto)
        : parseNullableNumber(data.perfisBruto)
    const perfisLiquidos =
      shouldPreserveTechnicalField(data.perfisLiquidos)
        ? parseNullableNumber(propostaAtual.perfis_liquidos)
        : parseNullableNumber(data.perfisLiquidos)
    const valorPerfil =
      shouldPreserveTechnicalField(data.valorPerfil)
        ? parseNullableNumber(propostaAtual.valor_perfil)
        : parseNullableNumber(data.valorPerfil)
    const valorVidro =
      shouldPreserveTechnicalField(data.valorVidro)
        ? parseNullableNumber(propostaAtual.valor_vidro)
        : parseNullableNumber(data.valorVidro)
    const valorAcessorios =
      shouldPreserveTechnicalField(data.valorAcessorios)
        ? parseNullableNumber(propostaAtual.valor_acessorios)
        : parseNullableNumber(data.valorAcessorios)
    const observacoesTecnicas =
      shouldPreserveTechnicalField(data.observacoesTecnicas)
        ? normalizeNullableText(propostaAtual.observacoes_tecnicas)
        : normalizeNullableText(data.observacoesTecnicas)

    if (user.role === 'vendedor' && !hasRuleAccess(user, 'canEditProposalDirectlyOutsideFunnel')) {
      const currentAreaM2 = parseNullableNumber(propostaAtual.area_m2)
      const currentPerfisBruto = parseNullableNumber(propostaAtual.perfis_bruto)
      const currentPerfisLiquidos = parseNullableNumber(propostaAtual.perfis_liquidos)
      const currentValorVidro = parseNullableNumber(propostaAtual.valor_vidro)
      const currentValorAcessorios = parseNullableNumber(propostaAtual.valor_acessorios)
      const currentValor = parseNullableNumber(propostaAtual.valor)
      const currentDescricao = normalizeNullableText(propostaAtual.descricao)
      const currentTitulo = normalizeNullableText(propostaAtual.titulo)
      const currentMaterialTag = normalizeMaterialTag(propostaAtual.material_tag)
      const isSellerClosingProposal = workflowAction === 'fechado'
      const sellerIsTryingToUploadAttachments = data.anexos.length > 0
      const sellerIsTryingToChangeClientData =
        data.clienteTipo === 'comercial' ||
        data.clienteTipo === 'residencial' ||
        data.clienteNome !== undefined ||
        data.clienteCpf !== undefined ||
        data.clienteEmail !== undefined ||
        data.clienteTelefone !== undefined ||
        data.clienteEndereco !== undefined ||
        data.clienteNumero !== undefined ||
        data.clienteBairro !== undefined ||
        data.clienteCidade !== undefined ||
        data.clienteEstado !== undefined ||
        data.clienteCep !== undefined
      const sellerIsTryingToChangeClosedValue =
        data.clienteValorFechado !== undefined || data.valor !== undefined
      const sellerIsInClosingContext =
        isSellerClosingProposal || sellerIsTryingToChangeClientData || sellerIsTryingToChangeClosedValue

      const sellerIsTryingToChangeProtectedProposalContent =
        sellerIsTryingToUploadAttachments ||
        (data.clienteId !== undefined && data.clienteId !== propostaAtual.cliente_id) ||
        normalizeNullableText(data.titulo ?? propostaAtual.titulo) !== currentTitulo ||
        normalizeMaterialTag(data.materialTag ?? propostaAtual.material_tag) !== currentMaterialTag ||
        areaM2 !== currentAreaM2 ||
        perfisBruto !== currentPerfisBruto ||
        perfisLiquidos !== currentPerfisLiquidos ||
        valorVidro !== currentValorVidro ||
        valorAcessorios !== currentValorAcessorios ||
        normalizeNullableText(data.observacoesTecnicas ?? propostaAtual.observacoes_tecnicas) !== observacoesTecnicas ||
        normalizeNullableText(data.descricao ?? propostaAtual.descricao) !== currentDescricao ||
        (data.desconto !== undefined &&
          parseNullableNumber(data.desconto) !== parseNullableNumber(propostaAtual.desconto)) ||
        (data.validade !== undefined &&
          normalizeNullableText(data.validade) !== normalizeNullableText(propostaAtual.validade)) ||
        (data.condicoes !== undefined &&
          normalizeNullableText(data.condicoes) !== normalizeNullableText(propostaAtual.condicoes)) ||
        (data.responsavelId !== undefined && data.responsavelId !== propostaAtual.responsavel_id) ||
        (data.orcamentistaId !== undefined && data.orcamentistaId !== propostaAtual.orcamentista_id)

      const sellerIsTryingToChangeValueOutsideClosing =
        !sellerIsInClosingContext && parseNullableNumber(data.valor ?? propostaAtual.valor) !== currentValor

      if (sellerIsTryingToChangeProtectedProposalContent || sellerIsTryingToChangeValueOutsideClosing) {
        return NextResponse.json(
          {
            error:
              'O vendedor nao pode alterar valor, anexos ou outros dados da proposta diretamente fora do fluxo de fechamento. Envie a proposta para retificacao no funil com a justificativa obrigatoria.',
          },
          { status: 403 }
        )
      }
    }

    if (mustValidateApprovalRequirements && requireApprovalPdf && !hasExistingProposalPdf && !hasNewProposalPdf) {
      return NextResponse.json(
        { error: 'Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.' },
        { status: 400 }
      )
    }

    if (mustValidateApprovalRequirements && requireApprovalTechnicalData) {
      const technicalFields = [
        areaM2,
        perfisBruto,
        perfisLiquidos,
        valorVidro,
        valorAcessorios,
      ]
      const hasAnyTechnicalField = technicalFields.some(
        (value) => value != null && Number.isFinite(value) && value > 0
      )

      if (!hasAnyTechnicalField) {
        return NextResponse.json(
          {
            error:
              'Preencha ao menos um dado tecnico da proposta antes de enviar para aprovacao (area em m2, perfis bruto, perfis liquidos, valor de vidro ou valor de acessorios).',
          },
          { status: 400 }
        )
      }
    }

    const storedStatus = nextStatus

    const requestedClosedValue = parseNullableNumber(data.clienteValorFechado)
    const requestedProposalValue = parseNullableNumber(data.valor)
    const requestedDiscount = parseNullableNumber(data.desconto)
    const existingProposalValue = parseNullableNumber(propostaAtual.valor)
    const existingFinalValue = parseNullableNumber(propostaAtual.valor_final)
    const shouldPreserveWorkflowTextField = (value: unknown) =>
      isWorkflowDrivenUpdate && normalizeNullableText(value) === null
    const materialTag =
      data.materialTag === undefined || shouldPreserveWorkflowTextField(data.materialTag)
        ? normalizeMaterialTag(propostaAtual.material_tag)
        : normalizeMaterialTag(data.materialTag)
    const valor = resolveSafeProposalValue({
      requestedClosedValue,
      requestedProposalValue,
      existingProposalValue,
      existingFinalValue,
    })
    const desconto =
      requestedDiscount ??
      (existingProposalValue && existingProposalValue > 0 ? parseNullableNumber(propostaAtual.desconto) : 0) ??
      0
    const valorFinal = valor - (valor * desconto) / 100
    const resolvedClienteId = requestedClienteId

    if (requiresPositiveProposalValue(storedStatus) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

    if (storedStatus === 'pos_fechamento' && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor da proposta antes de mover para pos-fechamento.' },
        { status: 400 }
      )
    }

      const [clienteAtual] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, nome, cpf, email, telefone, endereco, numero, bairro, cidade, estado, cep, status_funil, empresa, cargo, tipo
         FROM clientes
         WHERE id = ? LIMIT 1`,
        resolvedClienteId
      )

    if (!clienteAtual) {
      return NextResponse.json({ error: 'Cliente vinculado a proposta nao foi encontrado.' }, { status: 404 })
    }

    if (storedStatus === 'fechado') {
      const clientType =
        data.clienteTipo === 'comercial' || data.clienteTipo === 'residencial'
          ? data.clienteTipo
          : inferClientType(clienteAtual)
      const clientDocumentLabel = getClientDocumentLabel(clientType)
      const mergedClienteFechado = {
        nome: normalizeNullableText(data.clienteNome) ?? clienteAtual.nome,
        cpf: normalizeNullableText(data.clienteCpf) ?? clienteAtual.cpf,
        email: normalizeNullableText(data.clienteEmail) ?? clienteAtual.email,
        telefone: normalizeNullableText(data.clienteTelefone) ?? clienteAtual.telefone,
        endereco: normalizeNullableText(data.clienteEndereco) ?? clienteAtual.endereco,
        numero: normalizeNullableText(data.clienteNumero) ?? clienteAtual.numero,
        bairro: normalizeNullableText(data.clienteBairro) ?? clienteAtual.bairro,
        cidade: normalizeNullableText(data.clienteCidade) ?? clienteAtual.cidade,
        estado: normalizeNullableText(data.clienteEstado)?.toUpperCase() ?? clienteAtual.estado,
        cep: normalizeNullableText(data.clienteCep) ?? clienteAtual.cep,
      }

      const requiresMandatoryClosedClientData = requireClosedClientData
      const hasInvalidClosedClientDocument =
        Boolean(mergedClienteFechado.cpf) && !isValidClientDocument(mergedClienteFechado.cpf, clientType)

      if (
        requiresMandatoryClosedClientData &&
        (!mergedClienteFechado.nome ||
          !mergedClienteFechado.cpf ||
          !mergedClienteFechado.email ||
          !mergedClienteFechado.telefone ||
          !mergedClienteFechado.endereco ||
          valor <= 0)
      ) {
        return NextResponse.json(
          {
            error:
              `Para fechar a proposta, complete nome, ${clientDocumentLabel}, e-mail, telefone, endereco e valor fechado do cliente.`,
          },
          { status: 400 }
        )
      }

      if (hasInvalidClosedClientDocument) {
        return NextResponse.json(
          {
            error: `Informe um ${clientDocumentLabel} valido antes de concluir o fechamento da proposta.`,
          },
          { status: 400 }
        )
      }

      const shouldUpdateClosedClientData =
        Boolean(
          mergedClienteFechado.nome ||
            mergedClienteFechado.cpf ||
            mergedClienteFechado.email ||
            mergedClienteFechado.telefone ||
            mergedClienteFechado.endereco ||
            mergedClienteFechado.numero ||
            mergedClienteFechado.bairro ||
            mergedClienteFechado.cidade ||
            mergedClienteFechado.estado ||
            mergedClienteFechado.cep ||
            data.clienteTipo
        ) &&
        (requiresMandatoryClosedClientData ||
          data.clienteTipo === 'comercial' ||
          data.clienteTipo === 'residencial' ||
          normalizeNullableText(data.clienteNome) !== null ||
          normalizeNullableText(data.clienteCpf) !== null ||
          normalizeNullableText(data.clienteEmail) !== null ||
          normalizeNullableText(data.clienteTelefone) !== null ||
          normalizeNullableText(data.clienteEndereco) !== null ||
          normalizeNullableText(data.clienteNumero) !== null ||
          normalizeNullableText(data.clienteBairro) !== null ||
          normalizeNullableText(data.clienteCidade) !== null ||
          normalizeNullableText(data.clienteEstado) !== null ||
          normalizeNullableText(data.clienteCep) !== null)

      if (shouldUpdateClosedClientData) {
        await prisma.$executeRawUnsafe(
          `UPDATE clientes
           SET nome = ?, cpf = ?, email = ?, telefone = ?, endereco = ?, numero = ?, bairro = ?, cidade = ?, estado = ?, cep = ?, tipo = ?, status_funil = ?
           WHERE id = ?`,
          mergedClienteFechado.nome,
          mergedClienteFechado.cpf,
          mergedClienteFechado.email,
          mergedClienteFechado.telefone,
          mergedClienteFechado.endereco,
          mergedClienteFechado.numero,
          mergedClienteFechado.bairro,
          mergedClienteFechado.cidade,
          mergedClienteFechado.estado,
          mergedClienteFechado.cep,
          clientType,
          'fechado',
          resolvedClienteId
        )
      } else {
        await prisma.clientes.update({
          where: { id: resolvedClienteId },
          data: {
            tipo: clientType,
            status_funil: 'fechado',
          },
        })
      }
    }

    const servicos =
      Array.isArray(data.servicos) && !isWorkflowDrivenUpdate
        ? data.servicos
        : typeof propostaAtual.servicos === 'string'
          ? JSON.parse(propostaAtual.servicos || '[]')
          : propostaAtual.servicos || []
    const titulo =
      data.titulo === undefined || shouldPreserveWorkflowTextField(data.titulo)
        ? propostaAtual.titulo || 'Proposta Comercial'
        : data.titulo || 'Proposta Comercial'
    const descricao =
      data.descricao === undefined || shouldPreserveWorkflowTextField(data.descricao)
        ? propostaAtual.descricao ?? null
        : data.descricao
    const validade =
      data.validade === undefined || shouldPreserveWorkflowTextField(data.validade)
        ? propostaAtual.validade || null
        : data.validade || null
    const condicoes =
      data.condicoes === undefined || shouldPreserveWorkflowTextField(data.condicoes)
        ? propostaAtual.condicoes ?? null
        : data.condicoes ?? null

    const changedAt = new Date()
    const currentFollowUpBaseAt = parseDatabaseDateTime(propostaAtual.follow_up_base_at)
    const followUpBaseAt =
      previousStatus !== storedStatus
        ? resolveFollowUpBaseAt({
            previousStatus,
            nextStatus: storedStatus,
            changedAt,
            currentFollowUpBaseAt,
          })
        : currentFollowUpBaseAt || (
            ['follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias'].includes(storedStatus)
              ? changedAt
              : null
          )
    const followUpTime =
      data.followUpTime ??
      (previousStatus !== storedStatus && storedStatus === 'enviado_ao_cliente'
        ? formatFollowUpTimeFromDate(changedAt)
        : propostaAtual.follow_up_time ?? null)
    const posFechamentoAguardandoContratoAt =
      data.posFechamentoAguardandoContratoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_aguardando_contrato_at)
        : parseOptionalDateTime(data.posFechamentoAguardandoContratoAt)
    const posFechamentoContratoFeitoAt =
      data.posFechamentoContratoFeitoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_contrato_feito_at)
        : parseOptionalDateTime(data.posFechamentoContratoFeitoAt)
    const posFechamentoContratoEnviadoAt =
      data.posFechamentoContratoEnviadoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_contrato_enviado_at)
        : parseOptionalDateTime(data.posFechamentoContratoEnviadoAt)
    const posFechamentoContratoAssinadoAt =
      data.posFechamentoContratoAssinadoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_contrato_assinado_at)
        : parseOptionalDateTime(data.posFechamentoContratoAssinadoAt)
    const posFechamentoAguardandoPagamentoAt =
      data.posFechamentoAguardandoPagamentoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_aguardando_pagamento_at)
        : parseOptionalDateTime(data.posFechamentoAguardandoPagamentoAt)
    const posFechamentoPagamentoConfirmadoAt =
      data.posFechamentoPagamentoConfirmadoAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_pagamento_confirmado_at)
        : parseOptionalDateTime(data.posFechamentoPagamentoConfirmadoAt)
    const posFechamentoAguardandoOsAt =
      data.posFechamentoAguardandoOsAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_aguardando_os_at)
        : parseOptionalDateTime(data.posFechamentoAguardandoOsAt)
    const posFechamentoOrdemServicoLiberadaAt =
      data.posFechamentoOrdemServicoLiberadaAt === undefined
        ? parseOptionalDateTime(propostaAtual.pos_fechamento_ordem_servico_liberada_at)
        : parseOptionalDateTime(data.posFechamentoOrdemServicoLiberadaAt)

    await prisma.$executeRawUnsafe(
        `UPDATE propostas SET
        cliente_id = ?, titulo = ?, material_tag = ?, area_m2 = ?, perfis_bruto = ?, perfis_liquidos = ?, valor_perfil = ?, valor_vidro = ?, valor_acessorios = ?, observacoes_tecnicas = ?, descricao = ?, valor = ?, desconto = ?,
        valor_final = ?, status = ?, validade = ?, servicos = ?, condicoes = ?,
        responsavel_id = ?, orcamentista_id = ?, follow_up_base_at = ?, follow_up_time = ?,
        pos_fechamento_aguardando_contrato_at = ?, pos_fechamento_contrato_feito_at = ?, pos_fechamento_contrato_enviado_at = ?,
        pos_fechamento_contrato_assinado_at = ?, pos_fechamento_aguardando_pagamento_at = ?,
        pos_fechamento_pagamento_confirmado_at = ?, pos_fechamento_aguardando_os_at = ?,
        pos_fechamento_ordem_servico_liberada_at = ?, updated_at = NOW()
      WHERE id = ?`,
      resolvedClienteId,
      titulo,
      materialTag,
      areaM2,
      perfisBruto,
      perfisLiquidos,
      valorPerfil,
      valorVidro,
      valorAcessorios,
      observacoesTecnicas,
      descricao,
      valor,
      desconto,
      valorFinal,
      storedStatus,
      validade,
      JSON.stringify(servicos),
      condicoes,
      responsavelId,
      orcamentistaId,
      followUpBaseAt ? formatDateTime(followUpBaseAt) : null,
      followUpTime,
      serializeDateTimeForDatabase(posFechamentoAguardandoContratoAt),
      serializeDateTimeForDatabase(posFechamentoContratoFeitoAt),
      serializeDateTimeForDatabase(posFechamentoContratoEnviadoAt),
      serializeDateTimeForDatabase(posFechamentoContratoAssinadoAt),
      serializeDateTimeForDatabase(posFechamentoAguardandoPagamentoAt),
      serializeDateTimeForDatabase(posFechamentoPagamentoConfirmadoAt),
      serializeDateTimeForDatabase(posFechamentoAguardandoOsAt),
      serializeDateTimeForDatabase(posFechamentoOrdemServicoLiberadaAt),
      id
    )

    await syncProposalServices(id, servicos)

    const savedFilesPromise = saveProposalFiles(id, data.anexos)
    const commentPromise = commentText
      ? persistProposalComment(id, user.id, commentText)
      : Promise.resolve()
    const clientePromise =
      previousStatus !== storedStatus && resolvedClienteId !== propostaAtual.cliente_id
        ? prisma.clientes.findMany({
            where: { id: resolvedClienteId },
            select: { nome: true },
            take: 1,
          })
        : Promise.resolve([{ nome: propostaAtual.cliente_nome || 'cliente' }])

    const [savedFiles, clienteRows] = await Promise.all([
      savedFilesPromise,
      clientePromise,
      commentPromise,
    ])

    if (savedFiles.length > 0) {
      await persistSavedProposalFiles(id, user.id, savedFiles)
      await touchProposalUpdatedAt(id)
    }

    if (previousStatus !== storedStatus || data.kanbanPosition !== undefined) {
      await setProposalKanbanPosition(id, storedStatus, data.kanbanPosition ?? 0)
      await touchProposalUpdatedAt(id)
    }

    const cliente = clienteRows[0]

    if (previousStatus !== storedStatus) {
      await Promise.all([
        prisma.interacoes.create({
          data: {
            id: uuidv4(),
            cliente_id: resolvedClienteId,
            usuario_id: user.id,
            tipo: 'proposta',
            descricao: `Proposta ${propostaAtual.numero} alterada para ${storedStatus}`,
            dados: JSON.stringify({
              proposta_id: id,
              novo_status: storedStatus,
              notification_kind: 'proposal_status',
            }),
            created_at: changedAt,
          },
        }),
        syncProposalAutomation({
          propostaId: id,
          clienteId: resolvedClienteId,
          clienteNome: cliente?.nome || propostaAtual.cliente_nome || 'cliente',
          responsavelId,
          orcamentistaId,
          previousStatus,
          newStatus: storedStatus,
          changedAt,
          followUpBaseAt,
          followUpTime,
        }),
      ])
    } else {
      await prisma.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: resolvedClienteId,
          usuario_id: user.id,
          tipo: 'proposta',
          descricao: `Proposta ${propostaAtual.numero} atualizada`,
          dados: JSON.stringify({
            proposta_id: id,
            origem: 'edicao_proposta',
            silent_notification: true,
          }),
          created_at: changedAt,
        },
      })
    }

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
    invalidateRuntimeCache('proposta:detail:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta',
      resourceId: id,
    })

    if (savedFiles.length > 0) {
      await publishRealtimeEvent({
        actorUserId: user.id,
        resource: 'proposta_anexo',
        resourceId: id,
      })
    }

    if (previousStatus !== storedStatus) {
      await publishRealtimeEvent({
        actorUserId: user.id,
        resource: 'tarefa',
        resourceId: id,
      })
    }

    if (previousStatus !== storedStatus) {
      await notifyProposalEmail({
        responsavelId,
        orcamentistaId,
        actorUserId: user.id,
        actorName: user.nome,
        actorRole: user.role,
        proposalNumber: propostaAtual.numero,
        proposalTitle: data.titulo || propostaAtual.titulo || 'Proposta Comercial',
        clientName: cliente?.nome || propostaAtual.cliente_nome || data.clienteNome || null,
        nextStatus: storedStatus,
        nextStatusLabel: statusPropostaLabels[storedStatus],
      })
    }

    const proposta = await getProposalDetailPayload(id, undefined, user)
    return NextResponse.json(normalizeJsonPayload(proposta))
  } catch (error) {
    console.error('Erro ao atualizar proposta:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao atualizar proposta' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const proposta = await getProposal(id)

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canDeleteProposalsDirectly') || !canEditProposal(user, proposta)) {
      return NextResponse.json({ error: 'Voce nao pode excluir esta proposta' }, { status: 403 })
    }

    const anexos = await prisma.proposta_anexos.findMany({
      where: { proposta_id: id },
      select: { caminho: true },
    })

    await prisma.$transaction([
      prisma.proposta_anexos.deleteMany({ where: { proposta_id: id } }),
      prisma.proposta_comentarios.deleteMany({ where: { proposta_id: id } }),
      prisma.tarefas.deleteMany({
        where: {
          proposta_id: id,
          OR: [
            { origem: 'automacao_proposta' },
            { automacao_etapa: { not: null } },
          ],
        },
      }),
      prisma.propostas.delete({ where: { id } }),
    ])

    await deleteStoredFiles(anexos.map((item) => item.caminho))

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
    invalidateRuntimeCache('proposta:detail:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta',
      resourceId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar proposta:', error)
    return NextResponse.json({ error: 'Erro ao deletar proposta' }, { status: 500 })
  }
}
