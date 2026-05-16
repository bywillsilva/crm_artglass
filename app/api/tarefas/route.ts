import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { notifyTaskEmail } from '@/lib/server/email-notifications'
import { jsonNoStore } from '@/lib/server/http-cache'

const TAREFAS_CACHE_TTL_MS = Math.max(Number(process.env.TAREFAS_CACHE_TTL_MS || 30_000), 1000)

const TASK_SELECT = {
  id: true,
  titulo: true,
  descricao: true,
  tipo: true,
  data_hora: true,
  status: true,
  cliente_id: true,
  responsavel_id: true,
  proposta_id: true,
  automacao_etapa: true,
  origem: true,
  created_at: true,
  updated_at: true,
  propostas: {
    select: {
      cliente_id: true,
    },
  },
} as const

function isTransientTaskDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function mapTaskPayload(task: any) {
  if (!task) return null
  const { propostas, ...payload } = task
  return {
    ...payload,
    cliente_id_resolvido: payload.cliente_id || propostas?.cliente_id || null,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const tipo = searchParams.get('tipo')
  const clienteId = searchParams.get('cliente_id')
  const updatedSince = searchParams.get('updated_since')

  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }

    const canViewAllTasks = hasRuleAccess(user, 'canViewAllTasks')
    const responsavel = canViewAllTasks ? searchParams.get('responsavel') : user.id
    const cacheKey = `tarefas:list:${user.id}:${user.role}:${status || 'todos'}:${tipo || 'todos'}:${responsavel || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
    const cachedTarefas = getRuntimeCache<any[]>(cacheKey)
    if (cachedTarefas !== undefined) {
      return jsonNoStore(cachedTarefas)
    }

    const where: any = {}

    if (status && status !== 'todos') {
      where.status = status
    }

    if (tipo && tipo !== 'todos') {
      where.tipo = tipo
    }

    if (responsavel && responsavel !== 'todos') {
      where.responsavel_id = responsavel
    }

    if (clienteId) {
      where.OR = [
        { cliente_id: clienteId },
        { propostas: { cliente_id: clienteId } },
      ]
    }

    if (updatedSince) {
      where.updated_at = {
        gte: new Date(updatedSince),
      }
    }

    const tarefas = await prisma.tarefas.findMany({
      where,
      select: TASK_SELECT,
      orderBy: {
        data_hora: 'asc',
      },
    })
    const payload = tarefas.map(mapTaskPayload)
    setRuntimeCache(cacheKey, payload, TAREFAS_CACHE_TTL_MS)
    return jsonNoStore(payload)
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error)

    if (isTransientTaskDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
      }

      const canViewAllTasks = hasRuleAccess(user, 'canViewAllTasks')
      const responsavel = canViewAllTasks ? searchParams.get('responsavel') : user.id
      const cacheKey = `tarefas:list:${user.id}:${user.role}:${status || 'todos'}:${tipo || 'todos'}:${responsavel || 'todos'}:${clienteId || ''}:${updatedSince || ''}`
      const cachedTarefas = getRuntimeCache<any[]>(cacheKey)
      if (cachedTarefas) {
        return jsonNoStore(cachedTarefas)
      }

      if (updatedSince) {
        return jsonNoStore([], { status: 200 })
      }

      return jsonNoStore(
        { error: 'Lista de tarefas temporariamente indisponivel', degraded: true },
        { status: 503 }
      )
    }

    return jsonNoStore({ error: 'Erro ao buscar tarefas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()
    const now = new Date()
    const canChooseTaskResponsavel = hasRuleAccess(user, 'canAssignTaskResponsavel')
    const responsavelId =
      canChooseTaskResponsavel
        ? data.responsavelId
        : user.id

    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsavel obrigatorio' }, { status: 400 })
    }

    await prisma.$transaction([
      prisma.tarefas.create({
        data: {
          id,
          titulo: data.titulo || data.descricao || 'Tarefa',
          descricao: data.descricao || null,
          tipo: data.tipo || 'ligacao',
          data_hora: new Date(data.dataHora),
          status: data.status || 'pendente',
          cliente_id: data.clienteId,
          responsavel_id: responsavelId,
          proposta_id: data.propostaId || null,
          automacao_etapa: data.automacaoEtapa || null,
          origem: data.origem || 'manual',
        } as any,
      }),
      prisma.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: data.clienteId,
          usuario_id: user.id,
          tipo: 'tarefa',
          descricao: `Tarefa criada: ${data.titulo || data.descricao || 'Tarefa'}`,
          dados: JSON.stringify({ tarefa_id: id, origem: data.origem || 'manual' }),
          created_at: now,
        } as any,
      }),
    ])

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'tarefa',
      resourceId: id,
    })
    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('tarefa:detail:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')

    await notifyTaskEmail({
      responsavelId,
      actorUserId: user.id,
      actorName: user.nome,
      titulo: data.titulo || data.descricao || 'Tarefa',
      descricao: data.descricao || null,
      dataHora: data.dataHora || null,
      action: 'created',
    })

    const tarefa = await prisma.tarefas.findUnique({
      where: { id },
      select: TASK_SELECT,
    })
    return NextResponse.json(mapTaskPayload(tarefa), { status: 201 })
  } catch (error) {
    console.error('Erro ao criar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao criar tarefa' }, { status: 500 })
  }
}
