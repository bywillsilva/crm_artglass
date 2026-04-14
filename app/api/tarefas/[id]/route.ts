import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import {
  ensureResponsibilityIntegrity,
  ensureTaskSchema,
  formatDateTime,
} from '@/lib/server/proposal-workflow'

async function getAuthenticatedUser() {
  const session = await getServerSession()
  if (!session) {
    return null
  }

  const [user] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [session.userId]
  )

  if (!user || !user.ativo) {
    return null
  }

  return user
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const [tarefa] = await query<any[]>(
      `SELECT t.*, c.nome as cliente_nome, u.nome as responsavel_nome
       FROM tarefas t
       LEFT JOIN clientes c ON t.cliente_id = c.id
       LEFT JOIN usuarios u ON t.responsavel_id = u.id
       WHERE t.id = ?`,
      [id]
    )

    if (!tarefa) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && tarefa.responsavel_id !== user.id) {
      return NextResponse.json({ error: 'Acesso negado a esta tarefa' }, { status: 403 })
    }

    return NextResponse.json(tarefa)
  } catch (error) {
    console.error('Erro ao buscar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao buscar tarefa' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const [tarefaAtual] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && tarefaAtual.responsavel_id !== user.id) {
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
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()
    const [tarefaAtual] = await query<any[]>('SELECT * FROM tarefas WHERE id = ?', [id])

    if (!tarefaAtual) {
      return NextResponse.json({ error: 'Tarefa nao encontrada' }, { status: 404 })
    }

    if (user.role !== 'admin' && tarefaAtual.responsavel_id !== user.id) {
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
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()

    const user = await getAuthenticatedUser()
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

    if (user.role !== 'admin' && tarefa.responsavel_id !== user.id) {
      return NextResponse.json(
        { error: 'Apenas o responsavel pela tarefa ou o administrador podem exclui-la' },
        { status: 403 }
      )
    }

    await query('DELETE FROM tarefas WHERE id = ?', [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error)
    return NextResponse.json({ error: 'Erro ao deletar tarefa' }, { status: 500 })
  }
}
