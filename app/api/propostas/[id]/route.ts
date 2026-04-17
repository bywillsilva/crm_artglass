import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { deleteStoredFiles, saveProposalFiles } from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { statusPropostaLabels } from '@/lib/data/types'
import { notifyProposalEmail } from '@/lib/server/email-notifications'
import {
  canOrcamentistaAccessProposal,
  ensureCrmRuntimeSchema,
  formatDateTime,
  normalizeProposalStatus,
  parseDatabaseDateTime,
  requiresOrcamentistaAssignment,
  requiresPositiveProposalValue,
  syncDueFollowUpStatuses,
  syncProposalAutomation,
  type ProposalWorkflowStatus,
} from '@/lib/server/proposal-workflow'

const PROPOSTA_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.PROPOSTA_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

type ProposalPayload = {
  titulo?: string
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
  clienteNome?: string | null
  clienteCpf?: string | null
  clienteTelefone?: string | null
  clienteEmail?: string | null
  clienteEndereco?: string | null
  clienteValorFechado?: number | null
  anexos: File[]
}

type ProposalAttachmentRecord = {
  id: string
  nome_original: string | null
  tipo_mime: string | null
}

type SellerWorkflowAction =
  | 'enviado_ao_cliente'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'
  | 'stand_by'
  | 'outra_justificativa'

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
  follow_up_1_dia: ['aguardando_follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_3_dias: ['follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_3_dias: ['aguardando_follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
  stand_by: ['stand_by', 'enviar_ao_cliente', 'enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
}

const ORCAMENTISTA_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  novo_cliente: ['em_orcamento'],
  em_orcamento: ['aguardando_aprovacao', 'em_retificacao'],
  em_retificacao: ['aguardando_aprovacao', 'em_orcamento'],
}

const WORKFLOW_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  novo_cliente: ['em_orcamento'],
  em_orcamento: ['aguardando_aprovacao', 'em_retificacao'],
  em_retificacao: ['aguardando_aprovacao', 'em_orcamento'],
  aguardando_aprovacao: ['enviar_ao_cliente', 'em_retificacao'],
  enviar_ao_cliente: ['enviado_ao_cliente', 'aguardando_aprovacao', 'em_retificacao', 'em_orcamento'],
  enviado_ao_cliente: ['follow_up_1_dia', 'fechado', 'perdido', 'em_retificacao'],
  follow_up_1_dia: ['follow_up_3_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_3_dias: ['follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_3_dias: ['follow_up_7_dias', 'fechado', 'perdido', 'em_retificacao', 'stand_by'],
  aguardando_follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
  follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
  stand_by: ['enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
  fechado: ['enviado_ao_cliente', 'em_retificacao'],
  perdido: ['enviado_ao_cliente', 'em_retificacao'],
}

async function ensureBaseSchema() {
  await ensureCrmRuntimeSchema()
  await syncDueFollowUpStatuses()
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== 'string') {
    return value == null ? null : String(value)
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
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

function isSellerVisibleStatus(status: ProposalWorkflowStatus) {
  return SELLER_VISIBLE_STATUSES.includes(status)
}

function resolveSellerWorkflowStatus(
  currentStatus: ProposalWorkflowStatus,
  action: SellerWorkflowAction
): ProposalWorkflowStatus {
  if (action === 'enviado_ao_cliente') return 'enviado_ao_cliente'
  if (action === 'em_retificacao') return 'em_retificacao'
  if (action === 'fechado') return 'fechado'
  if (action === 'perdido') return 'perdido'
  if (action === 'stand_by') return 'stand_by'

  if (currentStatus === 'enviado_ao_cliente') {
    return 'follow_up_1_dia'
  }

  if (currentStatus === 'follow_up_1_dia') {
    return 'aguardando_follow_up_3_dias'
  }

  if (currentStatus === 'follow_up_3_dias') {
    return 'aguardando_follow_up_7_dias'
  }

  return currentStatus
}

function isSellerWorkflowActionAllowed(
  currentStatus: ProposalWorkflowStatus,
  action: SellerWorkflowAction
) {
  const allowedActions: Partial<Record<ProposalWorkflowStatus, SellerWorkflowAction[]>> = {
    enviar_ao_cliente: ['enviado_ao_cliente'],
    enviado_ao_cliente: ['fechado', 'perdido', 'em_retificacao', 'outra_justificativa'],
    follow_up_1_dia: ['fechado', 'perdido', 'em_retificacao', 'stand_by', 'outra_justificativa'],
    aguardando_follow_up_3_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by', 'outra_justificativa'],
    follow_up_3_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by', 'outra_justificativa'],
    aguardando_follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
    follow_up_7_dias: ['fechado', 'perdido', 'em_retificacao', 'stand_by'],
    stand_by: ['fechado', 'perdido', 'em_retificacao', 'enviado_ao_cliente'],
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

      return {
        titulo: String(formData.get('titulo') || '') || undefined,
        descricao: String(formData.get('descricao') || '') || undefined,
        valor: parseNullableNumber(formData.get('valor')),
        desconto: parseNullableNumber(formData.get('desconto')),
      status: String(formData.get('status') || '') || undefined,
      validade: String(formData.get('validade') || '') || null,
      servicos: parseJsonValue(formData.get('servicos'), [] as unknown[]),
      condicoes: String(formData.get('condicoes') || '') || null,
      responsavelId: String(formData.get('responsavelId') || '') || null,
      orcamentistaId: String(formData.get('orcamentistaId') || '') || null,
      comentario: String(formData.get('comentario') || '') || null,
      justificativa: String(formData.get('justificativa') || '') || null,
      workflowAction: String(formData.get('workflowAction') || '') || null,
      followUpTime: String(formData.get('followUpTime') || '') || null,
      clienteId: String(formData.get('clienteId') || '') || undefined,
      clienteNome: String(formData.get('clienteNome') || '') || null,
      clienteCpf: String(formData.get('clienteCpf') || '') || null,
      clienteTelefone: String(formData.get('clienteTelefone') || '') || null,
      clienteEmail: String(formData.get('clienteEmail') || '') || null,
      clienteEndereco: String(formData.get('clienteEndereco') || '') || null,
      clienteValorFechado: parseNullableNumber(formData.get('clienteValorFechado')),
      anexos: formData
        .getAll('anexos')
        .filter((value): value is File => value instanceof File && value.size > 0),
    }
  }

  const data = await request.json()
  return {
    titulo: data.titulo,
    descricao: data.descricao,
    valor: parseNullableNumber(data.valor),
    desconto: parseNullableNumber(data.desconto),
    status: data.status,
    validade: data.validade || null,
    servicos: Array.isArray(data.servicos) ? data.servicos : undefined,
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    justificativa: data.justificativa || null,
    workflowAction: data.workflowAction || null,
    followUpTime: data.followUpTime || null,
    clienteId: data.clienteId,
    clienteNome: data.clienteNome || null,
    clienteCpf: data.clienteCpf || null,
    clienteTelefone: data.clienteTelefone || null,
    clienteEmail: data.clienteEmail || null,
    clienteEndereco: data.clienteEndereco || null,
    clienteValorFechado: parseNullableNumber(data.clienteValorFechado),
    anexos: [],
  }
}

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

async function getProposal(id: string) {
  const [proposta] = await query<any[]>(
    `SELECT p.*, c.nome as cliente_nome, u.nome as responsavel_nome, o.nome as orcamentista_nome
     FROM propostas p
     LEFT JOIN clientes c ON p.cliente_id = c.id
     LEFT JOIN usuarios u ON p.responsavel_id = u.id
     LEFT JOIN usuarios o ON p.orcamentista_id = o.id
     WHERE p.id = ?`,
    [id]
  )

  return proposta
}

async function getProposalAttachments(id: string) {
  return query<ProposalAttachmentRecord[]>(
    `SELECT id, nome_original, tipo_mime
     FROM proposta_anexos
     WHERE proposta_id = ?`,
    [id]
  )
}

function canViewProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') {
    return proposta.responsavel_id === user.id
  }
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
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

  if (user.role === 'admin' || user.role === 'gerente') {
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
    case 'outra_justificativa':
      return `Outra justificativa\n${cleaned}`
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
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `proposta:detail:${user.id}:${user.role}:${id}`
    const cachedProposta = getRuntimeCache<any>(cacheKey)
    if (cachedProposta !== undefined) {
      return NextResponse.json(cachedProposta)
    }

    const proposta = await getProposal(id)

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canViewProposal(user, proposta)) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const anexos = await query<any[]>(
      `SELECT id, usuario_id, nome_original, tipo_mime, tamanho, created_at,
              CONCAT('/uploads/propostas/', proposta_id, '/', nome_arquivo) as url
       FROM proposta_anexos
       WHERE proposta_id = ?
       ORDER BY created_at DESC`,
      [id]
    )

    const comentarios = await query<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.proposta_id = ?
       ORDER BY pc.created_at DESC`,
      [id]
    )

    const payload = {
      ...proposta,
      anexos,
      comentarios,
    }

    setRuntimeCache(cacheKey, payload, PROPOSTA_DETAIL_CACHE_TTL_MS)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Erro ao buscar proposta:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedUser().catch(() => null)
      if (!user) {
        return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
      }

      const cacheKey = `proposta:detail:${user.id}:${user.role}:${id}`
      const cachedProposta = getRuntimeCache<any>(cacheKey)
      if (cachedProposta) {
        return NextResponse.json(cachedProposta, { status: 200 })
      }
    }

    return NextResponse.json({ error: 'Erro ao buscar proposta' }, { status: 500 })
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
    const requiresFollowUpComment =
      isStatusChange &&
      ((previousStatus === 'enviado_ao_cliente' && nextStatus === 'follow_up_1_dia') ||
        (previousStatus === 'follow_up_1_dia' && nextStatus === 'follow_up_3_dias') ||
        (previousStatus === 'follow_up_3_dias' && nextStatus === 'follow_up_7_dias'))
    const requiresReasonComment =
      isStatusChange &&
      (nextStatus === 'perdido' ||
        nextStatus === 'stand_by' ||
        (user.role === 'vendedor' && nextStatus === 'em_retificacao'))

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
          workflowAction === 'outra_justificativa' ||
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
          workflowAction === 'outra_justificativa' &&
          ['enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias'].includes(previousStatus) &&
          !data.followUpTime
        ) {
          return NextResponse.json(
            { error: 'Defina o horario do proximo follow-up antes de continuar.' },
            { status: 400 }
          )
        }
      }
    }

    if (previousStatus === 'aguardando_aprovacao' && nextStatus === 'enviar_ao_cliente' && !['admin', 'gerente'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Apenas administradores podem aprovar o orcamento pronto.' },
        { status: 403 }
      )
    }

    if ((requiresFollowUpComment || requiresReasonComment) && !rawCommentText) {
      return NextResponse.json(
        { error: 'Informe um comentario ou justificativa para seguir com esta etapa da proposta.' },
        { status: 400 }
      )
    }

    if (requiresFollowUpComment && !data.followUpTime) {
      return NextResponse.json(
        { error: 'Defina o horario do proximo follow-up antes de continuar.' },
        { status: 400 }
      )
    }

    const responsavelId =
      user.role === 'admin' || user.role === 'gerente'
        ? await validateUserRole(data.responsavelId || propostaAtual.responsavel_id, ['vendedor', 'gerente'])
        : propostaAtual.responsavel_id
    const requestedOrcamentistaId =
      data.orcamentistaId === undefined ? propostaAtual.orcamentista_id : data.orcamentistaId
    const resolvedOrcamentistaId =
      user.role === 'orcamentista' &&
      !requestedOrcamentistaId &&
      requiresOrcamentistaAssignment(nextStatus)
        ? user.id
        : requestedOrcamentistaId
    const orcamentistaId = await validateUserRole(resolvedOrcamentistaId, ['orcamentista'])
    const isOrcamentistaFieldChanging = data.orcamentistaId !== undefined

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

    if (mustValidateApprovalRequirements && !hasExistingProposalPdf && !hasNewProposalPdf) {
      return NextResponse.json(
        { error: 'Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.' },
        { status: 400 }
      )
    }

    const storedStatus =
      previousStatus === 'follow_up_1_dia' && nextStatus === 'follow_up_3_dias'
        ? 'aguardando_follow_up_3_dias'
        : previousStatus === 'follow_up_3_dias' && nextStatus === 'follow_up_7_dias'
          ? 'aguardando_follow_up_7_dias'
          : nextStatus

    const requestedClosedValue = parseNullableNumber(data.clienteValorFechado)
    const requestedProposalValue = parseNullableNumber(data.valor)
    const requestedDiscount = parseNullableNumber(data.desconto)
    const valor = requestedClosedValue ?? requestedProposalValue ?? parseNullableNumber(propostaAtual.valor) ?? 0
    const desconto = requestedDiscount ?? parseNullableNumber(propostaAtual.desconto) ?? 0
    const valorFinal = valor - (valor * desconto) / 100
    const resolvedClienteId = data.clienteId || propostaAtual.cliente_id

    if (requiresPositiveProposalValue(storedStatus) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

      const [clienteAtual] = await query<any[]>(
        `SELECT id, nome, cpf, email, telefone, endereco, status_funil
         FROM clientes
         WHERE id = ? LIMIT 1`,
        [resolvedClienteId]
      )

    if (!clienteAtual) {
      return NextResponse.json({ error: 'Cliente vinculado a proposta nao foi encontrado.' }, { status: 404 })
    }

    if (storedStatus === 'fechado') {
      const mergedClienteFechado = {
        nome: normalizeNullableText(data.clienteNome) ?? clienteAtual.nome,
        cpf: normalizeNullableText(data.clienteCpf) ?? clienteAtual.cpf,
        email: normalizeNullableText(data.clienteEmail) ?? clienteAtual.email,
        telefone: normalizeNullableText(data.clienteTelefone) ?? clienteAtual.telefone,
        endereco: normalizeNullableText(data.clienteEndereco) ?? clienteAtual.endereco,
      }

      if (
        !mergedClienteFechado.nome ||
        !mergedClienteFechado.cpf ||
        !mergedClienteFechado.email ||
        !mergedClienteFechado.telefone ||
        !mergedClienteFechado.endereco ||
        valor <= 0
      ) {
        return NextResponse.json(
          {
            error:
              'Para fechar a proposta, complete nome, CPF, e-mail, telefone, endereco e valor fechado do cliente.',
          },
          { status: 400 }
        )
      }

      await query(
        `UPDATE clientes
         SET nome = ?, cpf = ?, email = ?, telefone = ?, endereco = ?, status_funil = ?
         WHERE id = ?`,
        [
          mergedClienteFechado.nome,
          mergedClienteFechado.cpf,
          mergedClienteFechado.email,
          mergedClienteFechado.telefone,
          mergedClienteFechado.endereco,
          'fechado',
          resolvedClienteId,
        ]
      )
    }

    const servicos =
      Array.isArray(data.servicos)
        ? data.servicos
        : typeof propostaAtual.servicos === 'string'
          ? JSON.parse(propostaAtual.servicos || '[]')
          : propostaAtual.servicos || []

    const changedAt = new Date()
    const currentFollowUpBaseAt = parseDatabaseDateTime(propostaAtual.follow_up_base_at)
    const shouldResetFollowUpBase =
      previousStatus !== storedStatus && storedStatus === 'enviado_ao_cliente'
    const followUpBaseAt =
      shouldResetFollowUpBase
        ? changedAt
        : currentFollowUpBaseAt || (
            ['follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias'].includes(storedStatus)
              ? changedAt
              : null
          )
    const followUpTime = data.followUpTime ?? propostaAtual.follow_up_time ?? null

    await query(
      `UPDATE propostas SET
        cliente_id = ?, titulo = ?, descricao = ?, valor = ?, desconto = ?,
        valor_final = ?, status = ?, validade = ?, servicos = ?, condicoes = ?,
        responsavel_id = ?, orcamentista_id = ?, follow_up_base_at = ?, follow_up_time = ?
       WHERE id = ?`,
      [
        resolvedClienteId,
        data.titulo || propostaAtual.titulo || 'Proposta Comercial',
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
      await Promise.all(
        savedFiles.map((file) =>
          query(
            `INSERT INTO proposta_anexos (
              id, proposta_id, nome_original, nome_arquivo, caminho, tipo_mime, tamanho, usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [file.id, id, file.nomeOriginal, file.nomeArquivo, file.caminho, file.tipoMime, file.tamanho, user.id]
          )
        )
      )
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

    invalidateRuntimeCache('crm-bootstrap:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta',
      resourceId: id,
    })

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
        proposalNumber: propostaAtual.numero,
        proposalTitle: data.titulo || propostaAtual.titulo || 'Proposta Comercial',
        nextStatusLabel: statusPropostaLabels[storedStatus],
      })
    }

    const proposta = await getProposal(id)
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

    invalidateRuntimeCache('crm-bootstrap:')
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
