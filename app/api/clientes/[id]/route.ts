import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { formatDateTime } from '@/lib/server/proposal-workflow'
import { jsonNoStore } from '@/lib/server/http-cache'
import { ensureSchemaReadyForReads } from '@/lib/server/read-side-maintenance'
import { inferClientType } from '@/lib/utils/client-document'

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

    const [cliente] = await query<any[]>(
      `SELECT ${CLIENT_SELECT_COLUMNS}
       FROM clientes c
       WHERE c.id = ?`,
      [id]
    )

    if (!cliente) {
      return jsonNoStore({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    if (user.role === 'vendedor') {
      const [allowedProposal] = await query<any[]>(
        `SELECT 1
         FROM propostas
         WHERE cliente_id = ?
           AND responsavel_id = ?
         LIMIT 1`,
        [id, user.id]
      )

      if (cliente.responsavel_id !== user.id && !allowedProposal) {
        return jsonNoStore({ error: 'Acesso negado a este cliente' }, { status: 403 })
      }
    }

    setRuntimeCache(cacheKey, cliente, CLIENTE_DETAIL_CACHE_TTL_MS)
    return jsonNoStore(cliente)
  } catch (error) {
    console.error('Erro ao buscar cliente:', error)

    if (isTransientDatabaseError(error)) {
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

    const { id } = await params
    const data = (await request.json()) as Record<string, unknown>

      const [clienteAtual] = await query<any[]>(
        `SELECT
        id, nome, cpf, email, telefone, empresa, cargo, tipo, endereco, cidade, estado, cep,
        origem, status_funil, observacoes
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
        nome = ?, cpf = ?, email = ?, telefone = ?, empresa = ?, cargo = ?, tipo = ?,
        endereco = ?, cidade = ?, estado = ?, cep = ?, origem = ?,
        status_funil = ?, observacoes = ?
       WHERE id = ?`,
      [
        mergedCliente.nome,
        mergedCliente.cpf,
        mergedCliente.email,
        mergedCliente.telefone,
        mergedCliente.empresa,
        mergedCliente.cargo,
        mergedCliente.tipo,
        mergedCliente.endereco,
        mergedCliente.cidade,
        mergedCliente.estado,
        mergedCliente.cep,
        mergedCliente.origem,
        statusFunil,
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

    const [cliente] = await query<any[]>(
      `SELECT ${CLIENT_SELECT_COLUMNS}
       FROM clientes c
       WHERE c.id = ?`,
      [id]
    )
    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
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
    await query('DELETE FROM clientes WHERE id = ?', [id])

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
