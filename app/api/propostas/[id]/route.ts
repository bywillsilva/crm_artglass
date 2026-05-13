import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { deleteStoredFiles, persistSavedProposalFiles, saveProposalFiles } from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { statusPropostaLabels } from '@/lib/data/types'
import { notifyProposalEmail } from '@/lib/server/email-notifications'
import { jsonNoStore } from '@/lib/server/http-cache'
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
  clienteValorFechado?: number | null
  kanbanPosition?: number | null
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
  fechado: ['em_retificacao'],
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
  aguardando_aprovacao: ['enviar_ao_cliente', 'em_retificacao'],
  enviar_ao_cliente: ['enviado_ao_cliente', 'aguardando_aprovacao', 'em_retificacao', 'em_orcamento'],
  enviado_ao_cliente: ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao'],
  follow_up_1_dia: ['follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_3_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_3_dias: ['follow_up_1_dia', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_7_dias: ['follow_up_1_dia', 'follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  stand_by: ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
  fechado: ['enviado_ao_cliente', 'em_retificacao'],
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

  return null
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
  return user?.role === 'admin' || user?.role === 'orcamentista'
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
    clienteValorFechado: getOptionalJsonNumber('clienteValorFechado'),
    anexos: [],
  }
}

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

async function queryProposalByColumns(id: string, columns: string) {
  const [proposta] = await query<any[]>(
    `SELECT ${columns}
     FROM propostas p
     LEFT JOIN clientes c ON p.cliente_id = c.id
     LEFT JOIN usuarios u ON p.responsavel_id = u.id
     LEFT JOIN usuarios o ON p.orcamentista_id = o.id
     WHERE p.id = ?`,
    [id]
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
  return query<ProposalAttachmentRecord[]>(
    `SELECT id, nome_original, tipo_mime
     FROM proposta_anexos
     WHERE proposta_id = ?
     ORDER BY created_at DESC`,
     [id]
   )
}

async function getProposalDetailPayload(id: string, initialProposal?: any, user?: any) {
  const proposta = initialProposal ?? (await getProposal(id))
  if (!proposta) {
    return null
  }

  const [anexos, comentarios] = await Promise.all([
    query<ProposalDetailAttachment[]>(
      `SELECT id, usuario_id, nome_original, tipo_mime, tamanho, created_at,
              CONCAT('/api/propostas/', proposta_id, '/anexos/', id) as url
       FROM proposta_anexos
       WHERE proposta_id = ?
       ORDER BY created_at DESC`,
      [id]
    ),
    query<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.proposta_id = ?
       ORDER BY pc.created_at DESC`,
      [id]
    ),
  ])

    return sanitizeTechnicalProposalData({
      ...proposta,
      anexos,
      comentarios,
    }, user)
  }

function canViewProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return proposta.responsavel_id === user.id && isSellerVisibleStatus(normalizeProposalStatus(proposta.status))
  }
  if (user.role === 'orcamentista') {
    return canOrcamentistaViewProposal(proposta, user.id)
  }
  return false
}

function canEditProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return proposta.responsavel_id === user.id && isSellerVisibleStatus(normalizeProposalStatus(proposta.status))
  }
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
  }
  return false
}

function isTransitionAllowed(user: any, currentStatus: ProposalWorkflowStatus, nextStatus: ProposalWorkflowStatus) {
  if (currentStatus === nextStatus) {
    return true
  }

  if (user.role === 'admin') {
    return WORKFLOW_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false
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

  const [user] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [id]
  )

  if (!user || !user.ativo || !allowedRoles.includes(user.role)) {
    throw new Error('Usuario informado para a proposta e invalido.')
  }

  return user.id as string
}

async function persistProposalComment(propostaId: string, usuarioId: string, comentario: string) {
  const cleaned = comentario.trim()
  if (!cleaned) return

  await query(
    `INSERT INTO proposta_comentarios (id, proposta_id, usuario_id, comentario)
     VALUES (?, ?, ?, ?)`,
    [uuidv4(), propostaId, usuarioId, cleaned]
  )
}

async function touchProposalUpdatedAt(propostaId: string) {
  await query('UPDATE propostas SET updated_at = NOW() WHERE id = ?', [propostaId])
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

    setRuntimeCache(cacheKey, payload, PROPOSTA_DETAIL_CACHE_TTL_MS)
    return jsonNoStore(payload)
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
    const justificationText = normalizeNullableText(data.justificativa)
    const rawCommentText = normalizeNullableText(data.comentario) ?? justificationText
    const commentText = formatWorkflowComment(workflowAction, nextStatus, rawCommentText)
    const isAdminApprovalRefusalToRetification =
      user.role === 'admin' &&
      previousStatus === 'aguardando_aprovacao' &&
      nextStatus === 'em_retificacao'
    const requiresReasonComment =
      isStatusChange &&
      (nextStatus === 'fechado' ||
        nextStatus === 'perdido' ||
        nextStatus === 'stand_by' ||
        (nextStatus === 'em_retificacao' &&
          (user.role === 'vendedor' || (user.role === 'gerente' && !isAdminApprovalRefusalToRetification))))

    if (!isTransitionAllowed(user, previousStatus, nextStatus)) {
      return NextResponse.json(
        { error: 'Voce nao pode mover esta proposta para a etapa selecionada.' },
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
          workflowAction === 'perdido' ||
          workflowAction === 'stand_by' ||
          workflowAction === 'em_retificacao'

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

    if (previousStatus === 'aguardando_aprovacao' && nextStatus === 'enviar_ao_cliente' && user.role !== 'admin') {
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
      Boolean(workflowAction) || isStatusChange || data.kanbanPosition !== undefined
    const requestedClienteId =
      data.clienteId === undefined || (isWorkflowDrivenUpdate && !data.clienteId)
        ? propostaAtual.cliente_id
        : data.clienteId
    const requestedResponsavelId =
      !hasExplicitAssigneeId(data.responsavelId) || (isWorkflowDrivenUpdate && !data.responsavelId)
        ? propostaAtual.responsavel_id
        : data.responsavelId
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

    if (
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

    const shouldPreserveTechnicalField = (value: unknown) => isWorkflowDrivenUpdate && value == null
    const areaM2 =
      data.areaM2 === undefined || shouldPreserveTechnicalField(data.areaM2)
        ? parseNullableNumber(propostaAtual.area_m2)
        : parseNullableNumber(data.areaM2)
    const perfisBruto =
      data.perfisBruto === undefined || shouldPreserveTechnicalField(data.perfisBruto)
        ? parseNullableNumber(propostaAtual.perfis_bruto)
        : parseNullableNumber(data.perfisBruto)
    const perfisLiquidos =
      data.perfisLiquidos === undefined || shouldPreserveTechnicalField(data.perfisLiquidos)
        ? parseNullableNumber(propostaAtual.perfis_liquidos)
        : parseNullableNumber(data.perfisLiquidos)
    const valorPerfil =
      data.valorPerfil === undefined || shouldPreserveTechnicalField(data.valorPerfil)
        ? parseNullableNumber(propostaAtual.valor_perfil)
        : parseNullableNumber(data.valorPerfil)
    const valorVidro =
      data.valorVidro === undefined || shouldPreserveTechnicalField(data.valorVidro)
        ? parseNullableNumber(propostaAtual.valor_vidro)
        : parseNullableNumber(data.valorVidro)
    const valorAcessorios =
      data.valorAcessorios === undefined || shouldPreserveTechnicalField(data.valorAcessorios)
        ? parseNullableNumber(propostaAtual.valor_acessorios)
        : parseNullableNumber(data.valorAcessorios)
    const observacoesTecnicas =
      data.observacoesTecnicas === undefined || shouldPreserveTechnicalField(data.observacoesTecnicas)
        ? normalizeNullableText(propostaAtual.observacoes_tecnicas)
        : normalizeNullableText(data.observacoesTecnicas)

    if (user.role === 'vendedor') {
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
        data.clienteEndereco !== undefined
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

    if (mustValidateApprovalRequirements && !hasExistingProposalPdf && !hasNewProposalPdf) {
      return NextResponse.json(
        { error: 'Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.' },
        { status: 400 }
      )
    }

    if (mustValidateApprovalRequirements) {
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
    const materialTag =
      data.materialTag === undefined
        ? normalizeMaterialTag(propostaAtual.material_tag)
        : normalizeMaterialTag(data.materialTag)
    const valor = requestedClosedValue ?? requestedProposalValue ?? parseNullableNumber(propostaAtual.valor) ?? 0
    const desconto = requestedDiscount ?? parseNullableNumber(propostaAtual.desconto) ?? 0
    const valorFinal = valor - (valor * desconto) / 100
    const resolvedClienteId = requestedClienteId

    if (requiresPositiveProposalValue(storedStatus) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

      const [clienteAtual] = await query<any[]>(
        `SELECT id, nome, cpf, email, telefone, endereco, status_funil, empresa, cargo, tipo
         FROM clientes
         WHERE id = ? LIMIT 1`,
        [resolvedClienteId]
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
      }

      const requiresMandatoryClosedClientData = user.role === 'vendedor'
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
            data.clienteTipo
        ) &&
        (requiresMandatoryClosedClientData ||
          data.clienteTipo === 'comercial' ||
          data.clienteTipo === 'residencial' ||
          normalizeNullableText(data.clienteNome) !== null ||
          normalizeNullableText(data.clienteCpf) !== null ||
          normalizeNullableText(data.clienteEmail) !== null ||
          normalizeNullableText(data.clienteTelefone) !== null ||
          normalizeNullableText(data.clienteEndereco) !== null)

      if (shouldUpdateClosedClientData) {
        await query(
          `UPDATE clientes
           SET nome = ?, cpf = ?, email = ?, telefone = ?, endereco = ?, tipo = ?, status_funil = ?
           WHERE id = ?`,
          [
            mergedClienteFechado.nome,
            mergedClienteFechado.cpf,
            mergedClienteFechado.email,
            mergedClienteFechado.telefone,
            mergedClienteFechado.endereco,
            clientType,
            'fechado',
            resolvedClienteId,
          ]
        )
      } else {
        await query(`UPDATE clientes SET tipo = ?, status_funil = ? WHERE id = ?`, [clientType, 'fechado', resolvedClienteId])
      }
    }

    const servicos =
      Array.isArray(data.servicos)
        ? data.servicos
        : typeof propostaAtual.servicos === 'string'
          ? JSON.parse(propostaAtual.servicos || '[]')
          : propostaAtual.servicos || []

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

    await query(
        `UPDATE propostas SET
        cliente_id = ?, titulo = ?, material_tag = ?, area_m2 = ?, perfis_bruto = ?, perfis_liquidos = ?, valor_perfil = ?, valor_vidro = ?, valor_acessorios = ?, observacoes_tecnicas = ?, descricao = ?, valor = ?, desconto = ?,
        valor_final = ?, status = ?, validade = ?, servicos = ?, condicoes = ?,
        responsavel_id = ?, orcamentista_id = ?, follow_up_base_at = ?, follow_up_time = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        resolvedClienteId,
        data.titulo || propostaAtual.titulo || 'Proposta Comercial',
        materialTag,
        areaM2,
        perfisBruto,
        perfisLiquidos,
        valorPerfil,
        valorVidro,
        valorAcessorios,
        observacoesTecnicas,
        data.descricao ?? propostaAtual.descricao ?? null,
        valor,
        desconto,
        valorFinal,
        storedStatus,
        data.validade || propostaAtual.validade || null,
        JSON.stringify(servicos),
        data.condicoes ?? propostaAtual.condicoes ?? null,
        responsavelId,
        orcamentistaId,
        followUpBaseAt ? formatDateTime(followUpBaseAt) : null,
        followUpTime,
        id,
      ]
    )

    const savedFilesPromise = saveProposalFiles(id, data.anexos)
    const commentPromise = commentText
      ? persistProposalComment(id, user.id, commentText)
      : Promise.resolve()
    const clientePromise =
      previousStatus !== storedStatus && resolvedClienteId !== propostaAtual.cliente_id
        ? query<any[]>('SELECT nome FROM clientes WHERE id = ? LIMIT 1', [resolvedClienteId])
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

    if (previousStatus !== storedStatus || data.kanbanPosition !== null) {
      await setProposalKanbanPosition(id, storedStatus, data.kanbanPosition ?? 0)
      await touchProposalUpdatedAt(id)
    }

    const cliente = clienteRows[0]

    if (previousStatus !== storedStatus) {
      await Promise.all([
        query(
          `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
           VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
          [
            uuidv4(),
            resolvedClienteId,
            user.id,
            `Proposta ${propostaAtual.numero} alterada para ${storedStatus}`,
            JSON.stringify({
              proposta_id: id,
              novo_status: storedStatus,
              notification_kind: 'proposal_status',
            }),
            formatDateTime(changedAt),
          ]
        ),
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
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
        [
          uuidv4(),
          resolvedClienteId,
          user.id,
          `Proposta ${propostaAtual.numero} atualizada`,
          JSON.stringify({
            proposta_id: id,
            origem: 'edicao_proposta',
            silent_notification: true,
          }),
          formatDateTime(changedAt),
        ]
      )
    }

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('tarefas:list:')
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
    return NextResponse.json(proposta)
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

    if (!canEditProposal(user, proposta)) {
      return NextResponse.json({ error: 'Voce nao pode excluir esta proposta' }, { status: 403 })
    }

    const anexos = await query<any[]>(
      'SELECT caminho FROM proposta_anexos WHERE proposta_id = ?',
      [id]
    )

    await query('DELETE FROM proposta_anexos WHERE proposta_id = ?', [id])
    await query('DELETE FROM proposta_comentarios WHERE proposta_id = ?', [id])
    await query(
      `DELETE FROM tarefas
       WHERE proposta_id = ?
         AND (origem = 'automacao_proposta' OR automacao_etapa IS NOT NULL)`,
      [id]
    )
    await query('DELETE FROM propostas WHERE id = ?', [id])

    await deleteStoredFiles(anexos.map((item) => item.caminho))

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('tarefas:list:')
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
