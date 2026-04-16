import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { query } from '@/lib/db/mysql'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { ensureCrmRuntimeSchema, formatDateTime } from '@/lib/server/proposal-workflow'

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
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCrmRuntimeSchema()
    const { id } = await params
    const [cliente] = await query<any[]>(
      `SELECT c.*
       FROM clientes c
       WHERE c.id = ?`,
      [id]
    )

    if (!cliente) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    return NextResponse.json(cliente)
  } catch (error) {
    console.error('Erro ao buscar cliente:', error)
    return NextResponse.json({ error: 'Erro ao buscar cliente' }, { status: 500 })
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
    const data = (await request.json()) as Record<string, unknown>

      const [clienteAtual] = await query<any[]>(
        `SELECT
        id, nome, cpf, email, telefone, empresa, cargo, endereco, cidade, estado, cep,
        origem, status_funil, valor_potencial, observacoes
       FROM clientes
       WHERE id = ?`,
      [id]
    )

    if (!clienteAtual) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    const statusFunil =
      (data.statusFunil as string | undefined) ??
      (data.status as string | undefined) ??
      clienteAtual.status_funil ??
      'lead_novo'

    const valorPotencial = parseNullableNumber(
      data.valorPotencial ?? data.valorEstimado,
      clienteAtual.valor_potencial ?? 0
    )

    const mergedCliente = {
      nome: hasOwn(data, 'nome') ? normalizeNullableText(data.nome) : clienteAtual.nome,
      cpf: hasOwn(data, 'cpf') ? normalizeNullableText(data.cpf) : clienteAtual.cpf,
      email: hasOwn(data, 'email') ? normalizeNullableText(data.email) : clienteAtual.email,
      telefone: hasOwn(data, 'telefone') ? normalizeNullableText(data.telefone) : clienteAtual.telefone,
      empresa: hasOwn(data, 'empresa') ? normalizeNullableText(data.empresa) : clienteAtual.empresa,
      cargo: hasOwn(data, 'cargo') ? normalizeNullableText(data.cargo) : clienteAtual.cargo,
      endereco: hasOwn(data, 'endereco') ? normalizeNullableText(data.endereco) : clienteAtual.endereco,
      cidade: hasOwn(data, 'cidade') ? normalizeNullableText(data.cidade) : clienteAtual.cidade,
      estado: hasOwn(data, 'estado') ? normalizeNullableText(data.estado) : clienteAtual.estado,
      cep: hasOwn(data, 'cep') ? normalizeNullableText(data.cep) : clienteAtual.cep,
      origem: hasOwn(data, 'origem') ? normalizeNullableText(data.origem) : clienteAtual.origem,
      observacoes: hasOwn(data, 'observacoes')
        ? normalizeNullableText(data.observacoes)
        : clienteAtual.observacoes,
    }

    await query(
      `UPDATE clientes SET
        nome = ?, cpf = ?, email = ?, telefone = ?, empresa = ?, cargo = ?,
        endereco = ?, cidade = ?, estado = ?, cep = ?, origem = ?,
        status_funil = ?, valor_potencial = ?, observacoes = ?
       WHERE id = ?`,
      [
        mergedCliente.nome,
        mergedCliente.cpf,
        mergedCliente.email,
        mergedCliente.telefone,
        mergedCliente.empresa,
        mergedCliente.cargo,
        mergedCliente.endereco,
        mergedCliente.cidade,
        mergedCliente.estado,
        mergedCliente.cep,
        mergedCliente.origem,
        statusFunil,
        valorPotencial,
        mergedCliente.observacoes,
        id,
      ]
    )

    if (clienteAtual.status_funil !== statusFunil) {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'mudanca_status', ?, ?, ?)`,
        [
          uuidv4(),
          id,
          user.id,
          `Status alterado de ${clienteAtual.status_funil} para ${statusFunil}`,
          JSON.stringify({ de: clienteAtual.status_funil, para: statusFunil }),
          formatDateTime(new Date()),
        ]
      )
    }

    if ((clienteAtual.observacoes || '') !== (mergedCliente.observacoes || '')) {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'nota', ?, ?, ?)`,
        [
          uuidv4(),
          id,
          user.id,
          'Observacoes do cliente atualizadas',
          JSON.stringify({ campo: 'observacoes', origem: 'cliente' }),
          formatDateTime(new Date()),
        ]
      )
    }

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'cliente',
      resourceId: id,
    })

    const [cliente] = await query<any[]>('SELECT * FROM clientes WHERE id = ?', [id])
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
    await query('DELETE FROM clientes WHERE id = ?', [id])

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
