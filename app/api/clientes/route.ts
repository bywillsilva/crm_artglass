import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError, logDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { v4 as uuidv4 } from 'uuid'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { jsonNoStore } from '@/lib/server/http-cache'
import { ensureSchemaReadyForReads } from '@/lib/server/read-side-maintenance'
import {
  getNextProposalNumber,
  formatDateTime,
  setProposalKanbanPosition,
} from '@/lib/server/proposal-workflow'
import { inferClientType } from '@/lib/utils/client-document'

const CLIENTES_CACHE_TTL_MS = Math.max(Number(process.env.CLIENTES_CACHE_TTL_MS || 30_000), 1000)

const CLIENT_SELECT_COLUMNS = `
  c.id,
  c.nome,
  c.cpf,
  c.telefone,
  c.email,
  c.empresa,
  c.cargo,
  c.tipo,
  c.endereco,
  c.numero,
  c.bairro,
  c.cidade,
  c.estado,
  c.cep,
  c.origem,
  c.observacoes,
  c.status_funil,
  c.responsavel_id,
  c.created_at,
  c.updated_at
`

const CLIENT_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  telefone: true,
  email: true,
  empresa: true,
  cargo: true,
  tipo: true,
  endereco: true,
  numero: true,
  bairro: true,
  cidade: true,
  estado: true,
  cep: true,
  origem: true,
  observacoes: true,
  status_funil: true,
  responsavel_id: true,
  created_at: true,
  updated_at: true,
} as const

function isTransientClientDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function normalizeNullableText(value: unknown) {
  if (typeof value !== 'string') {
    return value == null ? null : String(value)
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseNullableNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback

    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

async function getDefaultProposalResponsavel(userId: string) {
  const currentUser = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { id: true, role: true, ativo: true },
  })

  if (currentUser?.ativo && ['vendedor', 'gerente'].includes(currentUser.role)) {
    return currentUser.id as string
  }

  const fallbackSeller = await prisma.usuarios.findFirst({
    where: {
      ativo: true,
      role: { in: ['vendedor', 'gerente'] },
    },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  })

  return (fallbackSeller?.id || userId) as string
}

async function getDefaultProposalOrcamentista(userId: string) {
  const currentUser = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { id: true, role: true, ativo: true },
  })

  if (currentUser?.ativo && currentUser.role === 'orcamentista') {
    return currentUser.id as string
  }

  const fallbackOrcamentista = await prisma.usuarios.findFirst({
    where: {
      ativo: true,
      role: 'orcamentista',
    },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  })

  return (fallbackOrcamentista?.id || null) as string | null
}

async function createInitialProposalForClient(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: {
    clienteId: string
    usuarioId: string
  }
) {
  const propostaId = uuidv4()
  const responsavelId = await getDefaultProposalResponsavel(params.usuarioId)
  const orcamentistaId = await getDefaultProposalOrcamentista(params.usuarioId)
  const maxAttempts = 5
  let numero: string | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nextNumero = await getNextProposalNumber()

    try {
      await tx.propostas.create({
        data: {
          id: propostaId,
          numero: nextNumero,
          cliente_id: params.clienteId,
          responsavel_id: responsavelId,
          orcamentista_id: orcamentistaId,
          retificacoes_count: 0,
          titulo: 'Novo cliente',
          descricao: null,
          valor: 0,
          desconto: 0,
          valor_final: 0,
          status: 'novo_cliente',
          validade: null,
          servicos: JSON.stringify([]),
          condicoes: null,
          follow_up_base_at: null,
          follow_up_time: null,
        },
      })
      numero = nextNumero
      break
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

  if (!numero) {
    throw new Error('Nao foi possivel gerar um numero unico para a proposta inicial do cliente.')
  }

  await tx.interacoes.create({
    data: {
      id: uuidv4(),
      cliente_id: params.clienteId,
      usuario_id: params.usuarioId,
      tipo: 'proposta',
      descricao: 'Card inicial da proposta criado automaticamente para o novo cliente',
      dados: JSON.stringify({
        proposta_id: propostaId,
        status: 'novo_cliente',
        origem: 'cliente_novo',
        silent_notification: true,
      }),
      created_at: new Date(),
    },
  })

  return {
    propostaId,
    numero,
    responsavelId,
    orcamentistaId,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const updatedSince = searchParams.get('updated_since')

  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    await ensureSchemaReadyForReads()

    const cacheKey = `clientes:list:${user.role}:${user.id}:${status || 'todos'}:${search || ''}:${updatedSince || ''}`
    const cachedClientes = getRuntimeCache<any[]>(cacheKey)
    if (cachedClientes !== undefined) {
      return jsonNoStore(cachedClientes)
    }

    const where: any = {}
    let rawSearchClientes: any[] | null = null

    if (!hasRuleAccess(user, 'canViewAllClients')) {
      where.OR = [
        { responsavel_id: user.id },
        { propostas: { some: { responsavel_id: user.id } } },
      ]
    }

    if (status && status !== 'todos') {
      where.status_funil = status
    }

    if (search) {
      const rawWhere: string[] = []
      const rawParams: unknown[] = []

      if (!hasRuleAccess(user, 'canViewAllClients')) {
        rawWhere.push(`(
          c.responsavel_id = ?
          OR EXISTS (
            SELECT 1
            FROM propostas p
            WHERE p.cliente_id = c.id
              AND p.responsavel_id = ?
          )
        )`)
        rawParams.push(user.id, user.id)
      }

      if (status && status !== 'todos') {
        rawWhere.push('c.status_funil = ?')
        rawParams.push(status)
      }

      rawWhere.push(`(
        c.nome COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci, '%')
        OR c.email COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci, '%')
        OR c.empresa COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci, '%')
      )`)
      rawParams.push(search, search, search)

      if (updatedSince) {
        rawWhere.push('c.updated_at >= ?')
        rawParams.push(updatedSince)
      }

      rawSearchClientes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ${CLIENT_SELECT_COLUMNS}
         FROM clientes c
         WHERE ${rawWhere.join(' AND ')}
         ORDER BY c.created_at DESC`,
        ...rawParams
      )
    }

    if (updatedSince) {
      where.updated_at = {
        gte: new Date(updatedSince),
      }
    }

    const clientes = rawSearchClientes ?? await prisma.clientes.findMany({
        where,
        select: CLIENT_SELECT,
        orderBy: {
          created_at: 'desc',
        },
      })
    setRuntimeCache(cacheKey, clientes, CLIENTES_CACHE_TTL_MS)
    return jsonNoStore(clientes)
  } catch (error) {
    console.error('Erro ao buscar clientes:', error)

    if (isTransientClientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      const cacheKey = user
        ? `clientes:list:${user.role}:${user.id}:${status || 'todos'}:${search || ''}:${updatedSince || ''}`
        : null
      const cachedClientes = cacheKey ? getRuntimeCache<any[]>(cacheKey) : null
      if (cachedClientes) {
        return jsonNoStore(cachedClientes)
      }

      if (updatedSince) {
        return jsonNoStore([], { status: 200 })
      }

      return jsonNoStore(
        { error: 'Lista de clientes temporariamente indisponivel', degraded: true },
        { status: 503 }
      )
    }

    return jsonNoStore({ error: 'Erro ao buscar clientes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let transactionCommitted = false
  let responseSnapshot: Record<string, unknown> | null = null

  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    await ensureSchemaReadyForReads()

    const data = (await request.json()) as Record<string, unknown>
    const id = uuidv4()
    const nome = normalizeNullableText(data.nome)

    if (!nome || nome.length < 2) {
      return NextResponse.json(
        { error: 'Informe um nome valido para o cliente.' },
        { status: 400 }
      )
    }

    const payload = {
      nome,
      cpf: normalizeNullableText(data.cpf),
      email: normalizeNullableText(data.email),
      telefone: normalizeNullableText(data.telefone),
      empresa: normalizeNullableText(data.empresa),
      cargo: normalizeNullableText(data.cargo),
      tipo: inferClientType({
        tipo: typeof data.tipo === 'string' ? data.tipo : null,
        empresa: normalizeNullableText(data.empresa),
        cargo: normalizeNullableText(data.cargo),
      }),
      endereco: normalizeNullableText(data.endereco),
      numero: normalizeNullableText(data.numero),
      bairro: normalizeNullableText(data.bairro),
      cidade: normalizeNullableText(data.cidade),
      estado: normalizeNullableText(data.estado),
      cep: normalizeNullableText(data.cep),
      origem: normalizeNullableText(data.origem),
      statusFunil: normalizeNullableText(data.statusFunil ?? data.status) || 'lead_novo',
      observacoes: normalizeNullableText(data.observacoes),
    }
    responseSnapshot = {
      id,
      nome: payload.nome,
      cpf: payload.cpf,
      telefone: payload.telefone,
      email: payload.email,
      empresa: payload.empresa,
      cargo: payload.cargo,
      tipo: payload.tipo,
      endereco: payload.endereco,
      numero: payload.numero,
      bairro: payload.bairro,
      cidade: payload.cidade,
      estado: payload.estado,
      cep: payload.cep,
      origem: payload.origem,
      observacoes: payload.observacoes,
      status_funil: payload.statusFunil,
      responsavel_id: null,
      created_at: formatDateTime(new Date()),
      updated_at: formatDateTime(new Date()),
    }

    const createdProposal = await prisma.$transaction(async (tx) => {
      await tx.clientes.create({
        data: {
          id,
          nome: payload.nome,
          cpf: payload.cpf,
          email: payload.email,
          telefone: payload.telefone,
          empresa: payload.empresa,
          cargo: payload.cargo,
          tipo: payload.tipo,
          endereco: payload.endereco,
          numero: payload.numero,
          bairro: payload.bairro,
          cidade: payload.cidade,
          estado: payload.estado,
          cep: payload.cep,
          origem: payload.origem as any,
          status_funil: payload.statusFunil as any,
          observacoes: payload.observacoes,
        },
      })

      await tx.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: id,
          usuario_id: user.id,
          tipo: 'nota',
          descricao: 'Cliente cadastrado no sistema',
          created_at: new Date(),
        },
      })

      return createInitialProposalForClient(tx, {
        clienteId: id,
        usuarioId: user.id,
      })
    })
    transactionCommitted = true

    try {
      await setProposalKanbanPosition(createdProposal.propostaId, 'novo_cliente', 0)
    } catch (error) {
      logDatabaseError('Erro ao posicionar proposta inicial do cliente', error)
    }

    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('crm-bootstrap:')
    invalidateRuntimeCache('dashboard:')

    try {
      await publishRealtimeEvent({
        actorUserId: user.id,
        resource: 'cliente',
        resourceId: id,
      })
      await publishRealtimeEvent({
        actorUserId: user.id,
        resource: 'proposta',
        resourceId: createdProposal.propostaId,
      })
    } catch (error) {
      logDatabaseError('Erro ao publicar eventos de cliente/proposta', error)
    }

    try {
      const [cliente] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ${CLIENT_SELECT_COLUMNS}
         FROM clientes c
         WHERE c.id = ?`,
        id
      )
      return NextResponse.json(cliente, { status: 201 })
    } catch (error) {
      logDatabaseError('Erro ao buscar cliente apos criacao', error)
      return NextResponse.json(responseSnapshot, { status: 201 })
    }
  } catch (error) {
    console.error('Erro ao criar cliente:', error)

    if (transactionCommitted) {
      return NextResponse.json(
        {
          ...responseSnapshot,
          warning: 'Cliente criado, mas houve falha em etapas complementares do processamento.',
        },
        { status: 201 }
      )
    }

    if (isTransientClientDatabaseError(error)) {
      return NextResponse.json(
        { error: 'Criacao de cliente temporariamente indisponivel. Tente novamente em instantes.' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar cliente' },
      { status: 500 }
    )
  }
}
