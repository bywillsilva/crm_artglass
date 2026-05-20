import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { jsonNoStore } from '@/lib/server/http-cache'
import { ensureSchemaReadyForReads } from '@/lib/server/read-side-maintenance'
import { inferClientType } from '@/lib/utils/client-document'
import { normalizeClientOrigin } from '@/lib/utils/client-origin'

const CLIENTE_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.CLIENTE_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

const CLIENT_SELECT_COLUMNS = `
  c.id,
  c.nome,
  c.cpf,
  c.email,
  c.telefone,
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
  c.status_funil,
  c.observacoes,
  c.responsavel_id,
  c.created_at,
  c.updated_at
`

const CLIENT_SELECT = {
  id: true,
  nome: true,
  cpf: true,
  email: true,
  telefone: true,
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
  status_funil: true,
  observacoes: true,
  responsavel_id: true,
  created_at: true,
  updated_at: true,
} as const

function isTransientClientDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function hasOwn(data: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(data, key)
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    await ensureSchemaReadyForReads()

    const cacheKey = `cliente:detail:${user.role}:${user.id}:${id}`
    const cachedCliente = getRuntimeCache<any>(cacheKey)
    if (cachedCliente !== undefined) {
      return jsonNoStore(cachedCliente)
    }

    const cliente = await prisma.clientes.findUnique({
      where: { id },
      select: CLIENT_SELECT,
    })

    if (!cliente) {
      return jsonNoStore({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canViewAllClients')) {
      const allowedProposal = await prisma.propostas.findFirst({
        where: {
          cliente_id: id,
          responsavel_id: user.id,
        },
        select: {
          id: true,
        },
      })

      if (cliente.responsavel_id !== user.id && !allowedProposal) {
        return jsonNoStore({ error: 'Acesso negado a este cliente' }, { status: 403 })
      }
    }

    setRuntimeCache(cacheKey, cliente, CLIENTE_DETAIL_CACHE_TTL_MS)
    return jsonNoStore(cliente)
  } catch (error) {
    console.error('Erro ao buscar cliente:', error)

    if (isTransientClientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      const cacheKey = user ? `cliente:detail:${user.role}:${user.id}:${id}` : null
      const cachedCliente = cacheKey ? getRuntimeCache<any>(cacheKey) : null
      if (cachedCliente) {
          return jsonNoStore(cachedCliente, { status: 200 })
      }
    }

    return jsonNoStore({ error: 'Erro ao buscar cliente' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    await ensureSchemaReadyForReads()

    if (!hasRuleAccess(user, 'canEditClientsDirectly')) {
      return NextResponse.json(
        {
          error:
            'Este usuario nao pode editar os dados do cliente diretamente por esta tela.',
        },
        { status: 403 }
      )
    }

    const { id } = await params
    const data = (await request.json()) as Record<string, unknown>

    const clienteAtual = await prisma.clientes.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        telefone: true,
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
        status_funil: true,
        observacoes: true,
      },
    })

    if (!clienteAtual) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    const statusFunil =
      (data.statusFunil as string | undefined) ??
      (data.status as string | undefined) ??
      clienteAtual.status_funil ??
      'lead_novo'

    const mergedCliente = {
      nome: hasOwn(data, 'nome') ? normalizeNullableText(data.nome) : clienteAtual.nome,
      cpf: hasOwn(data, 'cpf') ? normalizeNullableText(data.cpf) : clienteAtual.cpf,
      email: hasOwn(data, 'email') ? normalizeNullableText(data.email) : clienteAtual.email,
      telefone: hasOwn(data, 'telefone') ? normalizeNullableText(data.telefone) : clienteAtual.telefone,
      empresa: hasOwn(data, 'empresa') ? normalizeNullableText(data.empresa) : clienteAtual.empresa,
      cargo: hasOwn(data, 'cargo') ? normalizeNullableText(data.cargo) : clienteAtual.cargo,
      tipo: hasOwn(data, 'tipo')
        ? inferClientType({
            tipo: typeof data.tipo === 'string' ? data.tipo : null,
            empresa: hasOwn(data, 'empresa') ? normalizeNullableText(data.empresa) : clienteAtual.empresa,
            cargo: hasOwn(data, 'cargo') ? normalizeNullableText(data.cargo) : clienteAtual.cargo,
          })
        : inferClientType(clienteAtual),
      endereco: hasOwn(data, 'endereco') ? normalizeNullableText(data.endereco) : clienteAtual.endereco,
      numero: hasOwn(data, 'numero') ? normalizeNullableText(data.numero) : clienteAtual.numero,
      bairro: hasOwn(data, 'bairro') ? normalizeNullableText(data.bairro) : clienteAtual.bairro,
      cidade: hasOwn(data, 'cidade') ? normalizeNullableText(data.cidade) : clienteAtual.cidade,
      estado: hasOwn(data, 'estado') ? normalizeNullableText(data.estado) : clienteAtual.estado,
      cep: hasOwn(data, 'cep') ? normalizeNullableText(data.cep) : clienteAtual.cep,
      origem: hasOwn(data, 'origem') ? normalizeClientOrigin(data.origem) : normalizeClientOrigin(clienteAtual.origem),
      observacoes: hasOwn(data, 'observacoes')
        ? normalizeNullableText(data.observacoes)
        : clienteAtual.observacoes,
    }

    const operations: any[] = [
      prisma.clientes.update({
        where: { id },
        data: {
          nome: mergedCliente.nome,
          cpf: mergedCliente.cpf,
          email: mergedCliente.email,
          telefone: mergedCliente.telefone,
          empresa: mergedCliente.empresa,
          cargo: mergedCliente.cargo,
          tipo: mergedCliente.tipo,
          endereco: mergedCliente.endereco,
          numero: mergedCliente.numero,
          bairro: mergedCliente.bairro,
          cidade: mergedCliente.cidade,
          estado: mergedCliente.estado,
          cep: mergedCliente.cep,
          origem: mergedCliente.origem,
          status_funil: statusFunil,
          observacoes: mergedCliente.observacoes,
        } as any,
      }),
    ]

    if (clienteAtual.status_funil !== statusFunil) {
      operations.push(
        prisma.interacoes.create({
          data: {
            id: uuidv4(),
            cliente_id: id,
            usuario_id: user.id,
            tipo: 'mudanca_status',
            descricao: `Status alterado de ${clienteAtual.status_funil} para ${statusFunil}`,
            dados: JSON.stringify({ de: clienteAtual.status_funil, para: statusFunil }),
            created_at: new Date(),
          } as any,
        })
      )
    }

    if ((clienteAtual.observacoes || '') !== (mergedCliente.observacoes || '')) {
      operations.push(
        prisma.interacoes.create({
          data: {
            id: uuidv4(),
            cliente_id: id,
            usuario_id: user.id,
            tipo: 'nota',
            descricao: 'Observacoes do cliente atualizadas',
            dados: JSON.stringify({ campo: 'observacoes', origem: 'cliente' }),
            created_at: new Date(),
          } as any,
        })
      )
    }

    await prisma.$transaction(operations)

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'cliente',
      resourceId: id,
    })

    const cliente = await prisma.clientes.findUnique({
      where: { id },
      select: CLIENT_SELECT,
    })
    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
    return NextResponse.json(cliente)
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao atualizar cliente' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    await prisma.clientes.delete({
      where: { id },
    })

    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'cliente',
      resourceId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar cliente:', error)
    return NextResponse.json({ error: 'Erro ao deletar cliente' }, { status: 500 })
  }
}
