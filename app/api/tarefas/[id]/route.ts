import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { notifyTaskEmail } from '@/lib/server/email-notifications'
import {
  ensureCrmRuntimeSchema,
  formatDateTime,
} from '@/lib/server/proposal-workflow'

const TAREFA_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.TAREFA_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `tarefa:detail:${user.id}:${user.role}:${id}`
    const cachedTarefa = getRuntimeCache<any>(cacheKey)
    if (cachedTarefa !== undefined) {
      return NextResponse.json(cachedTarefa)
    }

    const [tarefa] = await query<any[]>(
      `SELECT
         t.*,
         COALESCE(t.cliente_id, p.cliente_id) as cliente_id_resolvido,
         c.nome as cliente_nome,
         u.nome as responsavel_nome
       FROM tarefas t
       LEFT JOIN propostas p ON t.proposta_id = p.id
       LEFT JOIN clientes c ON COALESCE(t.cliente_id, p.cliente_id) = c.id
       LEFT JOIN usuarios u ON t.responsavel_id = u.id
       WHERE t.id = ?`,
      [id]
    )

    if (!tarefa) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!['admin', 'gerente'].includes(user.role) && tarefa.responsavel_id !== user.id) {
      return NextResponse.json({ error: 'Acesso negado a esta tarefa' }, { status: 403 })
    }

    setRuntimeCache(cacheKey, tarefa, TAREFA_DETAIL_CACHE_TTL_MS)
    return NextResponse.json(tarefa)
  } catch (error) {
    console.error('Erro ao buscar tarefa:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
      }

      const cacheKey = `tarefa:detail:${user.id}:${user.role}:${id}`
      const cachedTarefa = getRuntimeCache<any>(cacheKey)
      if (cachedTarefa) {
        return NextResponse.json(cachedTarefa, { status: 200 })
      }
    }

    return NextResponse.json({ error: 'Erro ao buscar tarefa' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const [tarefaAtual] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!['admin', 'gerente'].includes(user.role) && tarefaAtual.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem edita-la' },
        { status: 403 }
      )
    }

    await query(
      `UPDATE tarefas SET
        titulo = ?, descricao = ?, tipo = ?, data_hora = ?,
        status = ?, cliente_id = ?, responsavel_id = ?
      WHERE id = ?`,
      [
        data.titulo || tarefaAtual.titulo || 'Tarefa',
        data.descricao || null,
        data.tipo || tarefaAtual.tipo,
        data.dataHora || tarefaAtual.data_hora,
        data.status || tarefaAtual.status,
        data.clienteId || tarefaAtual.cliente_id,
        data.responsavelId || tarefaAtual.responsavel_id,
        id,
      ]
    )

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'tarefa', ?, ?, ?)`,
      [
        uuidv4(),
        data.clienteId || tarefaAtual.cliente_id,
        user.id,
        `Tarefa atualizada: ${data.titulo || tarefaAtual.titulo || data.descricao || tarefaAtual.descricao}`,
        JSON.stringify({ tarefa_id: id, origem: 'edicao_tarefa' }),
        formatDateTime(new Date()),
      ]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'tarefa',
      resourceId: id,
    })

    await notifyTaskEmail({
      responsavelId: data.responsavelId || tarefaAtual.responsavel_id,
      actorUserId: user.id,
      actorName: user.nome,
      titulo: data.titulo || tarefaAtual.titulo || data.descricao || tarefaAtual.descricao || 'Tarefa',
      descricao: data.descricao || tarefaAtual.descricao || null,
      dataHora: data.dataHora || tarefaAtual.data_hora || null,
      action: 'updated',
    })

    const [tarefa] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])
    return NextResponse.json(tarefa)
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
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const [tarefaAtual] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!['admin', 'gerente'].includes(user.role) && tarefaAtual.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem altera-la' },
        { status: 403 }
      )
    }

    if (data.status) {
      await query('UPDATE tarefas SET status = ? WHERE id = ?', [data.status, id])

      if (tarefaAtual.status !== data.status) {
        await query(
          `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
           VALUES (?, ?, ?, 'tarefa', ?, ?, ?)`,
          [
            uuidv4(),
            tarefaAtual.cliente_id,
            user.id,
            `Status da tarefa alterado para ${data.status}: ${tarefaAtual.titulo || tarefaAtual.descricao}`,
            JSON.stringify({ tarefa_id: id, status: data.status, origem: 'status_tarefa' }),
            formatDateTime(new Date()),
          ]
        )
      }

      await publishRealtimeEvent({
        actorUserId: user.id,
        resource: 'tarefa',
        resourceId: id,
      })

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

    const [tarefa] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])
    return NextResponse.json(tarefa)
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
    await ensureCrmRuntimeSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const [tarefa] = await query<any[]>(
      'SELECT id, responsavel_id FROM tarefas WHERE id = ? LIMIT 1',
      [id]
    )

    if (!tarefa) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (!['admin', 'gerente'].includes(user.role) && tarefa.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem exclui-la' },
        { status: 403 }
      )
    }

    await query('DELETE FROM tarefas WHERE id = ?', [id])

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
