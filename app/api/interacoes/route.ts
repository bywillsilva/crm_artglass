import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { v4 as uuidv4 } from 'uuid'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const INTERACOES_CACHE_TTL_MS = Math.max(Number(process.env.INTERACOES_CACHE_TTL_MS || 10_000), 1000)
const MANUAL_INTERACTION_TYPES = new Set(['ligacao', 'reuniao', 'visita', 'email', 'nota'])

const INTERACTION_SELECT = {
  id: true,
  cliente_id: true,
  usuario_id: true,
  tipo: true,
  descricao: true,
  dados: true,
  proposta_id: true,
  novo_status: true,
  notification_kind: true,
  origem: true,
  silent_notification: true,
  created_at: true,
  usuarios: {
    select: {
      nome: true,
    },
  },
} as const

function isTransientInteractionDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function mapInteractionPayload(interaction: any) {
  if (!interaction) return null
  const { usuarios, ...payload } = interaction
  return {
    ...payload,
    usuario_nome: usuarios?.nome || null,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clienteId = searchParams.get('cliente_id')
  const tipo = searchParams.get('tipo')
  const limitParam = searchParams.get('limit')
  const notificationsOnly = searchParams.get('notifications_only') === 'true'
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 200) : null

  try {
    await ensureSystemDatabaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `interacoes:${user.role}:${user.id}:${clienteId || 'all'}:${tipo || 'all'}:${limit || 'all'}:${notificationsOnly ? 'notifications' : 'default'}`
    const where: any = {}

    if (clienteId) {
      where.cliente_id = clienteId
    }

    if (tipo) {
      where.tipo = tipo
    }

    if (notificationsOnly) {
      if (hasRuleAccess(user, 'canViewAllNotifications')) {
        // acesso total
      } else if (user.role === 'vendedor' || user.role === 'gerente') {
        where.OR = [
          { propostas: { responsavel_id: user.id } },
          { proposta_id: null, clientes: { responsavel_id: user.id } },
        ]
      } else if (user.role === 'orcamentista') {
        where.propostas = { orcamentista_id: user.id }
      }
    }

    const cachedInteracoes = getRuntimeCache<any[]>(cacheKey)
    if (cachedInteracoes !== undefined) {
      return NextResponse.json(cachedInteracoes)
    }

    const interacoes = await prisma.interacoes.findMany({
      where,
      select: INTERACTION_SELECT,
      orderBy: {
        created_at: 'desc',
      },
      ...(limit ? { take: limit } : {}),
    })
    const payload = interacoes.map(mapInteractionPayload)
    setRuntimeCache(cacheKey, payload, INTERACOES_CACHE_TTL_MS)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Erro ao buscar interacoes:', error)

    if (isTransientInteractionDatabaseError(error)) {
      const fallbackUser = await getAuthenticatedServerUser().catch(() => null)
      const fallbackCacheKey = fallbackUser
        ? `interacoes:${fallbackUser.role}:${fallbackUser.id}:${clienteId || 'all'}:${tipo || 'all'}:${limit || 'all'}:${notificationsOnly ? 'notifications' : 'default'}`
        : null
      return NextResponse.json(
        (fallbackCacheKey ? getRuntimeCache<any[]>(fallbackCacheKey) : null) || [],
        { status: 200 }
      )
    }

    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemDatabaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()
    const clienteId = typeof data.clienteId === 'string' ? data.clienteId.trim() : ''
    const descricao = typeof data.descricao === 'string' ? data.descricao.trim() : ''
    const tipo = typeof data.tipo === 'string' && MANUAL_INTERACTION_TYPES.has(data.tipo)
      ? data.tipo
      : 'nota'

    if (!clienteId) {
      return NextResponse.json({ error: 'Cliente obrigatorio para registrar interacao.' }, { status: 400 })
    }

    if (!descricao) {
      return NextResponse.json({ error: 'Descricao obrigatoria para registrar interacao.' }, { status: 400 })
    }

    await prisma.interacoes.create({
      data: {
        id,
        cliente_id: clienteId,
        usuario_id: user.id,
        tipo,
        descricao,
        dados: data.dados ? JSON.stringify(data.dados) : null,
        created_at: new Date(),
      } as any,
    })

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'interacao',
      resourceId: id,
    })

    invalidateRuntimeCache('interacoes:')

    const interacao = await prisma.interacoes.findUnique({
      where: { id },
      select: INTERACTION_SELECT,
    })
    return NextResponse.json(mapInteractionPayload(interacao), { status: 201 })
  } catch (error) {
    console.error('Erro ao criar interacao:', error)
    return NextResponse.json({ error: 'Erro ao criar interacao' }, { status: 500 })
  }
}
