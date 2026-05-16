import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { notifyTaskEmail } from '@/lib/server/email-notifications'
import { jsonNoStore } from '@/lib/server/http-cache'

const TAREFA_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.TAREFA_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

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

    const cacheKey = `tarefa:detail:${user.id}:${user.role}:${id}`
    const cachedTarefa = getRuntimeCache<any>(cacheKey)
    if (cachedTarefa !== undefined) {
      return jsonNoStore(cachedTarefa)
    }

    const tarefa = mapTaskPayload(await prisma.tarefas.findUnique({
      where: { id },
      select: TASK_SELECT,
    }))

    if (!tarefa) {
      return jsonNoStore({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canViewAllTasks') && tarefa.responsavel_id !== user.id) {
      return jsonNoStore({ error: 'Acesso negado a esta tarefa' }, { status: 403 })
    }

    setRuntimeCache(cacheKey, tarefa, TAREFA_DETAIL_CACHE_TTL_MS)
    return jsonNoStore(tarefa)
  } catch (error) {
    console.error('Erro ao buscar tarefa:', error)

    if (isTransientTaskDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
      }

      const cacheKey = `tarefa:detail:${user.id}:${user.role}:${id}`
      const cachedTarefa = getRuntimeCache<any>(cacheKey)
      if (cachedTarefa) {
        return jsonNoStore(cachedTarefa, { status: 200 })
      }
    }

    return jsonNoStore({ error: 'Erro ao buscar tarefa' }, { status: 500 })
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

    const { id } = await params
    const data = await request.json()
    const tarefaAtual = await prisma.tarefas.findUnique({
      where: { id },
      select: {
        id: true,
        titulo: true,
        descricao: true,
        tipo: true,
        data_hora: true,
        status: true,
        cliente_id: true,
        responsavel_id: true,
        proposta_id: true,
      },
    })

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canManageAllTasks') && tarefaAtual.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem edita-la' },
        { status: 403 }
      )
    }

    await prisma.$transaction([
      prisma.tarefas.update({
        where: { id },
        data: {
          titulo: data.titulo || tarefaAtual.titulo || 'Tarefa',
          descricao: data.descricao || null,
          tipo: data.tipo || tarefaAtual.tipo,
          data_hora: data.dataHora ? new Date(data.dataHora) : tarefaAtual.data_hora,
          status: data.status || tarefaAtual.status,
          cliente_id: data.clienteId || tarefaAtual.cliente_id,
          responsavel_id: data.responsavelId || tarefaAtual.responsavel_id,
        } as any,
      }),
      prisma.interacoes.create({
        data: {
          id: uuidv4(),
          cliente_id: data.clienteId || tarefaAtual.cliente_id,
          usuario_id: user.id,
          tipo: 'tarefa',
          descricao: `Tarefa atualizada: ${data.titulo || tarefaAtual.titulo || data.descricao || tarefaAtual.descricao}`,
          dados: JSON.stringify({ tarefa_id: id, origem: 'edicao_tarefa' }),
          created_at: new Date(),
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
      responsavelId: data.responsavelId || tarefaAtual.responsavel_id,
      actorUserId: user.id,
      actorName: user.nome,
      titulo: data.titulo || tarefaAtual.titulo || data.descricao || tarefaAtual.descricao || 'Tarefa',
      descricao: data.descricao || tarefaAtual.descricao || null,
      dataHora: data.dataHora || tarefaAtual.data_hora || null,
      action: 'updated',
    })

    const tarefa = await prisma.tarefas.findUnique({
      where: { id },
      select: TASK_SELECT,
    })
    return NextResponse.json(mapTaskPayload(tarefa))
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao atualizar tarefa' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const tarefaAtual = await prisma.tarefas.findUnique({
      where: { id },
      select: {
        id: true,
        titulo: true,
        descricao: true,
        data_hora: true,
        status: true,
        cliente_id: true,
        responsavel_id: true,
      },
    })

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canManageAllTasks') && tarefaAtual.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem altera-la' },
        { status: 403 }
      )
    }

    if (data.status) {
      const operations: any[] = [
        prisma.tarefas.update({
          where: { id },
          data: { status: data.status } as any,
        }),
      ]

      if (tarefaAtual.status !== data.status) {
        operations.push(
          prisma.interacoes.create({
            data: {
              id: uuidv4(),
              cliente_id: tarefaAtual.cliente_id,
              usuario_id: user.id,
              tipo: 'tarefa',
              descricao: `Status da tarefa alterado para ${data.status}: ${tarefaAtual.titulo || tarefaAtual.descricao}`,
              dados: JSON.stringify({ tarefa_id: id, status: data.status, origem: 'status_tarefa' }),
              created_at: new Date(),
            } as any,
          })
        )
      }

      await prisma.$transaction(operations)

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
        responsavelId: tarefaAtual.responsavel_id,
        actorUserId: user.id,
        actorName: user.nome,
        titulo: tarefaAtual.titulo || tarefaAtual.descricao || 'Tarefa',
        descricao: tarefaAtual.descricao || null,
        dataHora: tarefaAtual.data_hora || null,
        action: 'status_changed',
      })
    }

    const tarefa = await prisma.tarefas.findUnique({
      where: { id },
      select: TASK_SELECT,
    })
    return NextResponse.json(mapTaskPayload(tarefa))
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao atualizar tarefa' }, { status: 500 })
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
    const tarefa = await prisma.tarefas.findUnique({
      where: { id },
      select: {
        id: true,
        responsavel_id: true,
      },
    })

    if (!tarefa) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!hasRuleAccess(user, 'canManageAllTasks') && tarefa.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem exclui-la' },
        { status: 403 }
      )
    }

    await prisma.tarefas.delete({
      where: { id },
    })

    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('tarefa:detail:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('crm-bootstrap:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'tarefa',
      resourceId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao deletar tarefa' }, { status: 500 })
  }
}
