import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { persistSavedProposalFiles, saveProposalFiles } from '@/lib/server/proposal-files'
import { syncProposalServices } from '@/lib/server/proposal-services'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { jsonNoStore } from '@/lib/server/http-cache'
import { normalizeJsonPayload } from '@/lib/server/json-normalize'
import { ensureProposalReadSideReady } from '@/lib/server/read-side-maintenance'
import {
  getNextProposalNumber,
  formatDateTime,
  handleProposalAutomationOnCreate,
  normalizeProposalStatus,
  requiresOrcamentistaAssignment,
  requiresPositiveProposalValue,
  setProposalKanbanPosition,
  type ProposalWorkflowStatus,
} from '@/lib/server/proposal-workflow'

const PROPOSTAS_CACHE_TTL_MS = Math.max(Number(process.env.PROPOSTAS_CACHE_TTL_MS || 30_000), 1000)

const SELLER_VISIBLE_STATUSES = [
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
] as const

const PROPOSAL_LIST_SELECT_COLUMNS = `
  p.id,
  p.numero,
  p.cliente_id,
  p.responsavel_id,
  p.orcamentista_id,
  p.retificacoes_count,
  p.titulo,
  p.material_tag,
  p.area_m2,
  p.perfis_bruto,
  p.perfis_liquidos,
  p.valor_perfil,
  p.valor_vidro,
  p.valor_acessorios,
  p.observacoes_tecnicas,
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome,
  COALESCE(pa.anexos_count, 0) as anexos_count,
  COALESCE(pc.comentarios_count, 0) as comentarios_count
`

const PROPOSAL_LIST_SELECT_COLUMNS_LEGACY = `
  p.id,
  p.numero,
  p.cliente_id,
  p.responsavel_id,
  p.orcamentista_id,
  p.retificacoes_count,
  p.titulo,
  p.material_tag,
  NULL as area_m2,
  NULL as perfis_bruto,
  NULL as perfis_liquidos,
  NULL as valor_perfil,
  NULL as valor_vidro,
  NULL as valor_acessorios,
  NULL as observacoes_tecnicas,
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome,
  COALESCE(pa.anexos_count, 0) as anexos_count,
  COALESCE(pc.comentarios_count, 0) as comentarios_count
`

type ProposalPayload = {
  clienteId: string
  titulo?: string
  materialTag?: string | null
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
  followUpTime?: string | null
  kanbanPosition?: number | null
  anexos: File[]
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function parseNumberLike(value: unknown) {
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

function parseKanbanPosition(value: unknown) {
  const parsed = parseNumberLike(value)
  if (parsed == null) {
    return null
  }

  return Math.max(0, Math.trunc(parsed))
}

function normalizeMaterialTag(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, 80) : null
  }

  if (value == null) {
    return null
  }

  const normalized = String(value).trim()
  return normalized ? normalized.slice(0, 80) : null
}

function parseDateOnly(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseTimeOnly(value: string | null) {
  if (!value) {
    return null
  }

  const [hours, minutes, seconds = '00'] = value.split(':')
  const parsed = new Date(Date.UTC(1970, 0, 1, Number(hours), Number(minutes), Number(seconds)))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function insertProposalWithUniqueNumber(params: {
  id: string
  clienteId: string
  responsavelId: string
  orcamentistaId: string | null
  titulo: string
  descricao: string | null
  valor: number
  desconto: number
  valorFinal: number
  status: ProposalWorkflowStatus
  validade: string | null
  servicos: unknown[]
  condicoes: string | null
  materialTag: string | null
  now: Date
  followUpTime: string | null
}) {
  const maxAttempts = 5

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const numero = await getNextProposalNumber()

    try {
      await prisma.propostas.create({
        data: {
          id: params.id,
          numero,
          cliente_id: params.clienteId,
          responsavel_id: params.responsavelId,
          orcamentista_id: params.orcamentistaId,
          retificacoes_count: 0,
          titulo: params.titulo,
          descricao: params.descricao,
          material_tag: params.materialTag,
          valor: params.valor,
          desconto: params.desconto,
          valor_final: params.valorFinal,
          status: params.status,
          validade: parseDateOnly(params.validade),
          servicos: JSON.stringify(params.servicos),
          condicoes: params.condicoes,
          follow_up_base_at: params.status === 'enviado_ao_cliente' ? params.now : null,
          follow_up_time: parseTimeOnly(params.followUpTime),
        },
      })

      return numero
    } catch (error: any) {
      const isNumeroDuplicate =
        error?.code === 'P2002' ||
        (error?.code === 'ER_DUP_ENTRY' &&
          String(error?.sqlMessage || '').toLowerCase().includes('for key') &&
          String(error?.sqlMessage || '').toLowerCase().includes('numero'))

      if (!isNumeroDuplicate || attempt === maxAttempts - 1) {
        throw error
      }
    }
  }

  throw new Error('Nao foi possivel gerar um numero unico para a proposta.')
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
        clienteId: String(formData.get('clienteId') || ''),
        titulo: String(formData.get('titulo') || 'Proposta Comercial'),
        materialTag: normalizeMaterialTag(formData.get('materialTag')),
        descricao: String(formData.get('descricao') || ''),
        valor: parseNumberLike(formData.get('valor')),
        desconto: parseNumberLike(formData.get('desconto')),
      status: String(formData.get('status') || ''),
      validade: String(formData.get('validade') || '') || null,
      servicos: parseJsonValue(formData.get('servicos'), [] as unknown[]),
      condicoes: String(formData.get('condicoes') || '') || null,
      responsavelId: String(formData.get('responsavelId') || '') || null,
      orcamentistaId: String(formData.get('orcamentistaId') || '') || null,
      comentario: String(formData.get('comentario') || '') || null,
    followUpTime: String(formData.get('followUpTime') || '') || null,
    kanbanPosition: parseKanbanPosition(formData.get('kanbanPosition')),
    anexos: formData
        .getAll('anexos')
        .filter((value): value is File => value instanceof File && value.size > 0),
    }
  }

  const data = await request.json()
  return {
    clienteId: data.clienteId,
    titulo: data.titulo,
    materialTag: normalizeMaterialTag(data.materialTag),
    descricao: data.descricao,
    valor: parseNumberLike(data.valor),
    desconto: parseNumberLike(data.desconto),
    status: data.status,
    validade: data.validade || null,
    servicos: Array.isArray(data.servicos) ? data.servicos : [],
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    followUpTime: data.followUpTime || null,
    kanbanPosition: parseKanbanPosition(data.kanbanPosition),
    anexos: [],
  }
}

async function ensureBaseSchema() {
  await ensureProposalReadSideReady()
}

async function getAuthenticatedUser() {
  return getAuthenticatedServerUser()
}

async function validateResponsavel(responsavelId: string | null, sessionUser: any) {
  const resolvedId =
    sessionUser.role === 'admin' || sessionUser.role === 'gerente'
      ? responsavelId
      : sessionUser.role === 'orcamentista'
        ? responsavelId
        : sessionUser.id

  if (!resolvedId) {
    throw new Error('Selecione um vendedor responsavel para a proposta.')
  }

  const responsavel = await prisma.usuarios.findUnique({
    where: { id: resolvedId },
    select: {
      id: true,
      role: true,
      ativo: true,
    },
  })

  if (!responsavel || !responsavel.ativo || !['vendedor', 'gerente'].includes(responsavel.role)) {
    throw new Error('O responsavel informado para a proposta e invalido.')
  }

  return responsavel.id as string
}

async function validateOrcamentista(orcamentistaId: string | null) {
  if (!orcamentistaId) {
    return null
  }

  const orcamentista = await prisma.usuarios.findUnique({
    where: { id: orcamentistaId },
    select: {
      id: true,
      role: true,
      ativo: true,
    },
  })

  if (!orcamentista || !orcamentista.ativo || orcamentista.role !== 'orcamentista') {
    throw new Error('O orcamentista informado para a proposta e invalido.')
  }

  return orcamentista.id as string
}

async function persistProposalComment(propostaId: string, usuarioId: string, comentario: string) {
  const cleaned = comentario.trim()
  if (!cleaned) {
    return
  }

  await prisma.proposta_comentarios.create({
    data: {
      id: uuidv4(),
      proposta_id: propostaId,
      usuario_id: usuarioId,
      comentario: cleaned,
    },
  })
}

async function findReusableSeedProposal(clienteId: string) {
  const [proposal] = await prisma.propostas.findMany({
    where: {
      cliente_id: clienteId,
      status: 'novo_cliente',
      valor: {
        lte: 0,
      },
      OR: [
        { descricao: null },
        { descricao: '' },
      ],
      titulo: {
        startsWith: 'Novo cliente',
      },
      proposta_anexos: {
        none: {},
      },
      proposta_comentarios: {
        none: {},
      },
    },
    select: {
      id: true,
      numero: true,
    },
    orderBy: {
      created_at: 'desc',
    },
    take: 1,
  })

  return proposal || null
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const clienteId = searchParams.get('cliente_id')
  const updatedSince = searchParams.get('updated_since')

  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    const cacheKey = `propostas:list:${user.id}:${user.role}:${status || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
    const cachedPropostas = getRuntimeCache<any[]>(cacheKey)
    if (cachedPropostas !== undefined) {
      return jsonNoStore(cachedPropostas)
    }

    const buildListQuery = (selectColumns: string) => `
      SELECT
        ${selectColumns}
      FROM propostas p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN usuarios u ON p.responsavel_id = u.id
      LEFT JOIN usuarios o ON p.orcamentista_id = o.id
      LEFT JOIN (
        SELECT proposta_id, COUNT(*) as anexos_count
        FROM proposta_anexos
        GROUP BY proposta_id
      ) pa ON pa.proposta_id = p.id
      LEFT JOIN (
        SELECT proposta_id, COUNT(*) as comentarios_count
        FROM proposta_comentarios
        GROUP BY proposta_id
      ) pc ON pc.proposta_id = p.id
      WHERE 1=1
    `
    let sql = buildListQuery(PROPOSAL_LIST_SELECT_COLUMNS)
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND p.status = ?'
      params.push(status)
    }

    if (clienteId) {
      sql += ' AND p.cliente_id = ?'
      params.push(clienteId)
    }

    if (updatedSince) {
      sql += ' AND p.updated_at >= ?'
      params.push(updatedSince)
    }

    if (user.role === 'vendedor') {
      if (!hasRuleAccess(user, 'allowSellerViewReleasedProposals')) {
        sql += ' AND 1=0'
      } else {
      sql += ` AND p.responsavel_id = ? AND p.status IN (${SELLER_VISIBLE_STATUSES.map(() => '?').join(', ')})`
      params.push(user.id, ...SELLER_VISIBLE_STATUSES)
      }
    } else if (user.role === 'orcamentista') {
      if (hasRuleAccess(user, 'allowOrcamentistaViewAssignedProposalsOutsideScope')) {
      sql += ` AND (
        p.orcamentista_id = ?
        OR (
          p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
          AND (p.orcamentista_id IS NULL OR p.orcamentista_id = '')
        )
      )`
      params.push(user.id)
      } else {
        sql += ` AND (
          p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
          AND (p.orcamentista_id IS NULL OR p.orcamentista_id = '' OR p.orcamentista_id = ?)
        )`
        params.push(user.id)
      }
    }

    sql += ' ORDER BY p.created_at DESC'

    let propostas: any[]
    try {
      propostas = await prisma.$queryRawUnsafe<any[]>(sql, ...params)
    } catch (error) {
      if (!isUnknownColumnError(error)) {
        throw error
      }

      const legacySql = sql.replace(PROPOSAL_LIST_SELECT_COLUMNS, PROPOSAL_LIST_SELECT_COLUMNS_LEGACY)
      propostas = await prisma.$queryRawUnsafe<any[]>(legacySql, ...params)
    }
    const payload = normalizeJsonPayload(propostas)
    setRuntimeCache(cacheKey, payload, PROPOSTAS_CACHE_TTL_MS)
    return jsonNoStore(payload)
  } catch (error) {
    console.error('Erro ao buscar propostas:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedUser().catch(() => null)
      if (!user) {
        return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
      }

      const cacheKey = `propostas:list:${user.id}:${user.role}:${status || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
      const cachedPropostas = getRuntimeCache<any[]>(cacheKey)
      if (cachedPropostas) {
        return jsonNoStore(cachedPropostas)
      }

      if (updatedSince) {
        return jsonNoStore([], { status: 200 })
      }

      return jsonNoStore(
        { error: 'Lista de propostas temporariamente indisponivel', degraded: true },
        { status: 503 }
      )
    }

    return jsonNoStore({ error: 'Erro ao buscar propostas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    if (!hasRuleAccess(user, 'canCreateProposals')) {
      return NextResponse.json(
        { error: 'Este usuario nao pode criar novas propostas diretamente.' },
        { status: 403 }
      )
    }

    const data = await parseProposalPayload(request)
    const id = uuidv4()
    const now = new Date()
    const status = normalizeProposalStatus(data.status)
    const cliente = await prisma.clientes.findUnique({
      where: { id: data.clienteId },
      select: {
        id: true,
        nome: true,
        responsavel_id: true,
      },
    })

    if (!cliente) {
      return NextResponse.json({ error: 'Cliente nao encontrado para a proposta' }, { status: 404 })
    }

    const responsavelBase = hasRuleAccess(user, 'canSelectProposalResponsavelOnForm')
      ? user.role === 'orcamentista'
        ? String(data.responsavelId || cliente.responsavel_id || '')
        : (data.responsavelId || null)
      : user.role === 'orcamentista'
        ? String(cliente.responsavel_id || '')
        : (user.id || cliente.responsavel_id || null)
    const responsavelId = await validateResponsavel(responsavelBase, user)
    const orcamentistaId = await validateOrcamentista(
      hasRuleAccess(user, 'canAssignProposalOrcamentistaOnForm')
        ? user.role === 'orcamentista'
          ? (data.orcamentistaId || user.id)
          : (data.orcamentistaId || null)
        : user.role === 'orcamentista'
          ? user.id
          : null
    )

    if (requiresOrcamentistaAssignment(status) && !orcamentistaId) {
      return NextResponse.json(
        { error: 'Selecione um orcamentista para iniciar o fluxo comercial da proposta.' },
        { status: 400 }
      )
    }

    const valor = parseNumberLike(data.valor) ?? 0
    const desconto = parseNumberLike(data.desconto) ?? 0
    const valorFinal = valor - (valor * desconto) / 100
    const materialTag = normalizeMaterialTag(data.materialTag)

    if (status === 'aguardando_aprovacao' && !data.anexos.some(isPdfFile)) {
      return NextResponse.json(
        { error: 'Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.' },
        { status: 400 }
      )
    }

    if (requiresPositiveProposalValue(status) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

    const reusableSeedProposal = await findReusableSeedProposal(data.clienteId)
    const propostaId = reusableSeedProposal?.id || id
    const numero =
      reusableSeedProposal?.numero ||
      (await insertProposalWithUniqueNumber({
        id: propostaId,
        clienteId: data.clienteId,
        responsavelId,
        orcamentistaId,
        titulo: data.titulo || 'Proposta Comercial',
        materialTag,
        descricao: data.descricao || null,
        valor,
        desconto,
        valorFinal,
        status,
        validade: data.validade || null,
        servicos: data.servicos || [],
        condicoes: data.condicoes || null,
        now,
        followUpTime: data.followUpTime || null,
      }))

    if (reusableSeedProposal) {
      await prisma.propostas.update({
        where: { id: propostaId },
        data: {
          cliente_id: data.clienteId,
          responsavel_id: responsavelId,
          orcamentista_id: orcamentistaId,
          titulo: data.titulo || 'Proposta Comercial',
          descricao: data.descricao || null,
          material_tag: materialTag,
          valor,
          desconto,
          valor_final: valorFinal,
          status,
          validade: parseDateOnly(data.validade || null),
          servicos: JSON.stringify(data.servicos || []),
          condicoes: data.condicoes || null,
          follow_up_base_at: status === 'enviado_ao_cliente' ? now : null,
          follow_up_time: parseTimeOnly(data.followUpTime || null),
        },
      })
    }

    await syncProposalServices(propostaId, data.servicos || [])

    if (data.comentario?.trim()) {
      await persistProposalComment(propostaId, user.id, data.comentario)
    }

    const savedFiles = await saveProposalFiles(propostaId, data.anexos)
    await persistSavedProposalFiles(propostaId, user.id, savedFiles)
    await setProposalKanbanPosition(propostaId, status, data.kanbanPosition ?? 0)

    await prisma.interacoes.create({
      data: {
        id: uuidv4(),
        cliente_id: data.clienteId,
        usuario_id: user.id,
        tipo: 'proposta',
        descricao: `Proposta ${numero} criada em ${status}`,
        dados: JSON.stringify({ proposta_id: propostaId, status, silent_notification: true }),
        created_at: now,
      },
    })

    await handleProposalAutomationOnCreate({
      clienteId: data.clienteId,
      clienteNome: cliente.nome,
      responsavelId,
      orcamentistaId,
      propostaId,
      status,
      createdAt: now,
      followUpBaseAt: status === 'enviado_ao_cliente' ? now : null,
      followUpTime: data.followUpTime || null,
    })

    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta',
      resourceId: propostaId,
    })

    const [proposta] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         ${PROPOSAL_LIST_SELECT_COLUMNS}
        FROM propostas p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        LEFT JOIN usuarios u ON p.responsavel_id = u.id
        LEFT JOIN usuarios o ON p.orcamentista_id = o.id
        LEFT JOIN (
          SELECT proposta_id, COUNT(*) as anexos_count
          FROM proposta_anexos
          GROUP BY proposta_id
        ) pa ON pa.proposta_id = p.id
        LEFT JOIN (
          SELECT proposta_id, COUNT(*) as comentarios_count
          FROM proposta_comentarios
          GROUP BY proposta_id
        ) pc ON pc.proposta_id = p.id
        WHERE p.id = ?`,
      propostaId
    )
    return NextResponse.json(normalizeJsonPayload(proposta), { status: 201 })
  } catch (error) {
    console.error('Erro ao criar proposta:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar proposta' },
      { status: 500 }
    )
  }
}
