import { NextRequest, NextResponse } from 'next/server'
import { getConnection, isTransientDatabaseError, query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import {
  ensureCrmRuntimeSchema,
  getNextProposalNumber,
  formatDateTime,
} from '@/lib/server/proposal-workflow'

const CLIENTES_CACHE_TTL_MS = Math.max(Number(process.env.CLIENTES_CACHE_TTL_MS || 30_000), 1000)

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

async function ensureBaseSchema() {
  await ensureCrmRuntimeSchema()
}

async function getDefaultProposalResponsavel(userId: string) {
  const [currentUser] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [userId]
  )

  if (currentUser?.ativo && ['vendedor', 'gerente'].includes(currentUser.role)) {
    return currentUser.id as string
  }

  const [fallbackSeller] = await query<any[]>(
    `SELECT id
     FROM usuarios
     WHERE ativo = TRUE
       AND role IN ('vendedor', 'gerente')
     ORDER BY created_at ASC
     LIMIT 1`
  )

  return (fallbackSeller?.id || userId) as string
}

async function getDefaultProposalOrcamentista(userId: string) {
  const [currentUser] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [userId]
  )

  if (currentUser?.ativo && currentUser.role === 'orcamentista') {
    return currentUser.id as string
  }

  const [fallbackOrcamentista] = await query<any[]>(
    `SELECT id
     FROM usuarios
     WHERE ativo = TRUE
       AND role = 'orcamentista'
     ORDER BY created_at ASC
     LIMIT 1`
  )

  return (fallbackOrcamentista?.id || null) as string | null
}

async function createInitialProposalForClient(
  connection: Awaited<ReturnType<typeof getConnection>>,
  params: {
    clienteId: string
    clienteNome: string
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
      await connection.execute(
        `INSERT INTO propostas (
          id, numero, cliente_id, responsavel_id, orcamentista_id, retificacoes_count, titulo, descricao,
          valor, desconto, valor_final, status, validade, servicos, condicoes, follow_up_base_at, follow_up_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          propostaId,
          nextNumero,
          params.clienteId,
          responsavelId,
          orcamentistaId,
          0,
          `Novo cliente - ${params.clienteNome}`,
          null,
          0,
          0,
          0,
          'novo_cliente',
          null,
          JSON.stringify([]),
          null,
          null,
          null,
        ]
      )
      numero = nextNumero
      break
    } catch (error: any) {
      const isNumeroDuplicate =
        error?.code === 'ER_DUP_ENTRY' &&
        String(error?.sqlMessage || '').toLowerCase().includes('for key') &&
        String(error?.sqlMessage || '').toLowerCase().includes('numero')

      if (!isNumeroDuplicate || attempt === maxAttempts - 1) {
        throw error
      }
    }
  }

  if (!numero) {
    throw new Error('Nao foi possivel gerar um numero unico para a proposta inicial do cliente.')
  }

  await connection.execute(
    `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
     VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
    [
      uuidv4(),
      params.clienteId,
      params.usuarioId,
      'Card inicial da proposta criado automaticamente para o novo cliente',
      JSON.stringify({
        proposta_id: propostaId,
        status: 'novo_cliente',
        origem: 'cliente_novo',
        silent_notification: true,
      }),
      formatDateTime(new Date()),
    ]
  )
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const updatedSince = searchParams.get('updated_since')

  try {
    await ensureBaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const cacheKey = `clientes:list:${user.role}:${user.id}:${status || 'todos'}:${search || ''}:${updatedSince || ''}`
    const cachedClientes = getRuntimeCache<any[]>(cacheKey)
    if (cachedClientes !== undefined) {
      return NextResponse.json(cachedClientes)
    }

    let sql = `
      SELECT c.*
      FROM clientes c
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND c.status_funil = ?'
      params.push(status)
    }

    if (search) {
      sql += ' AND (c.nome LIKE ? OR c.email LIKE ? OR c.empresa LIKE ?)'
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    if (updatedSince) {
      sql += ' AND c.updated_at >= ?'
      params.push(updatedSince)
    }

    sql += ' ORDER BY c.created_at DESC'

    const clientes = await query(sql, params)
    setRuntimeCache(cacheKey, clientes, CLIENTES_CACHE_TTL_MS)
    return NextResponse.json(clientes)
  } catch (error) {
    console.error('Erro ao buscar clientes:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      const cacheKey = user
        ? `clientes:list:${user.role}:${user.id}:${status || 'todos'}:${search || ''}:${updatedSince || ''}`
        : null
      return NextResponse.json((cacheKey && getRuntimeCache<any[]>(cacheKey)) || [], { status: 200 })
    }

    return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    await ensureBaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

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
      endereco: normalizeNullableText(data.endereco),
      cidade: normalizeNullableText(data.cidade),
      estado: normalizeNullableText(data.estado),
      cep: normalizeNullableText(data.cep),
      origem: normalizeNullableText(data.origem),
      statusFunil: normalizeNullableText(data.statusFunil ?? data.status) || 'lead_novo',
      observacoes: normalizeNullableText(data.observacoes),
    }

    connection = await getConnection()
    await connection.beginTransaction()

      await connection.execute(
        `INSERT INTO clientes (
        id, nome, cpf, email, telefone, empresa, cargo, endereco, cidade, estado, cep,
        origem, status_funil, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          id,
          payload.nome,
          payload.cpf,
          payload.email,
          payload.telefone,
        payload.empresa,
        payload.cargo,
        payload.endereco,
        payload.cidade,
        payload.estado,
          payload.cep,
          payload.origem,
          payload.statusFunil,
          payload.observacoes,
        ]
    )

    await connection.execute(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, created_at)
       VALUES (?, ?, ?, 'nota', 'Cliente cadastrado no sistema', ?)`,
      [uuidv4(), id, user.id, formatDateTime(new Date())]
    )

    await createInitialProposalForClient(connection, {
      clienteId: id,
      clienteNome: payload.nome,
      usuarioId: user.id,
    })

    await connection.commit()

    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
    invalidateRuntimeCache('crm-bootstrap:')

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'cliente',
      resourceId: id,
    })

    const [cliente] = await query<any[]>('SELECT * FROM clientes WHERE id = ?', [id])
    return NextResponse.json(cliente, { status: 201 })
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback()
      } catch {
        // Ignora falhas ao reverter a transacao.
      }
    }

    console.error('Erro ao criar cliente:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar cliente' },
      { status: 500 }
    )
  } finally {
    connection?.release()
  }
}
