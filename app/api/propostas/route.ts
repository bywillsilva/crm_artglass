import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { saveProposalFiles } from '@/lib/server/proposal-files'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { invalidateRuntimeCache } from '@/lib/server/runtime-cache'
import {
  ensureCrmRuntimeSchema,
  getNextProposalNumber,
  formatDateTime,
  handleProposalAutomationOnCreate,
  normalizeProposalStatus,
  requiresOrcamentistaAssignment,
  requiresPositiveProposalValue,
  syncDueFollowUpStatuses,
  type ProposalWorkflowStatus,
} from '@/lib/server/proposal-workflow'

type ProposalPayload = {
  clienteId: string
  titulo?: string
  descricao?: string
  valor?: number | null
  desconto?: number | null
  status?: string
  validade?: string | null
  servicos?: unknown[]
  condicoes?: string | null
  responsavelId?: string | null
  orcamentistaId?: string | null
  comentario?: string | null
  followUpTime?: string | null
  anexos: File[]
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function parseNumberLike(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

async function insertProposalWithUniqueNumber(params: {
  id: string
  clienteId: string
  responsavelId: string
  orcamentistaId: string | null
  titulo: string
  descricao: string | null
  valor: number
  desconto: number
  valorFinal: number
  status: ProposalWorkflowStatus
  validade: string | null
  servicos: unknown[]
  condicoes: string | null
  now: Date
  followUpTime: string | null
}) {
  const maxAttempts = 5

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const numero = await getNextProposalNumber()

    try {
      await query(
        `INSERT INTO propostas (
          id, numero, cliente_id, responsavel_id, orcamentista_id, retificacoes_count, titulo, descricao,
          valor, desconto, valor_final, status, validade, servicos, condicoes, follow_up_base_at, follow_up_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.id,
          numero,
          params.clienteId,
          params.responsavelId,
          params.orcamentistaId,
          0,
          params.titulo,
          params.descricao,
          params.valor,
          params.desconto,
          params.valorFinal,
          params.status,
          params.validade,
          JSON.stringify(params.servicos),
          params.condicoes,
          params.status === 'enviado_ao_cliente' ? formatDateTime(params.now) : null,
          params.followUpTime,
        ]
      )

      return numero
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

  throw new Error('Nao foi possivel gerar um numero unico para a proposta.')
}

async function parseProposalPayload(request: NextRequest): Promise<ProposalPayload> {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const parseJsonValue = <T>(value: FormDataEntryValue | null, fallback: T) => {
      if (typeof value !== 'string' || !value.trim()) return fallback
      try {
        return JSON.parse(value) as T
      } catch {
        return fallback
      }
    }

      return {
        clienteId: String(formData.get('clienteId') || ''),
        titulo: String(formData.get('titulo') || 'Proposta Comercial'),
        descricao: String(formData.get('descricao') || ''),
        valor: parseNumberLike(formData.get('valor')),
        desconto: parseNumberLike(formData.get('desconto')),
      status: String(formData.get('status') || ''),
      validade: String(formData.get('validade') || '') || null,
      servicos: parseJsonValue(formData.get('servicos'), [] as unknown[]),
      condicoes: String(formData.get('condicoes') || '') || null,
      responsavelId: String(formData.get('responsavelId') || '') || null,
      orcamentistaId: String(formData.get('orcamentistaId') || '') || null,
      comentario: String(formData.get('comentario') || '') || null,
      followUpTime: String(formData.get('followUpTime') || '') || null,
      anexos: formData
        .getAll('anexos')
        .filter((value): value is File => value instanceof File && value.size > 0),
    }
  }

  const data = await request.json()
  return {
    clienteId: data.clienteId,
    titulo: data.titulo,
    descricao: data.descricao,
    valor: parseNumberLike(data.valor),
    desconto: parseNumberLike(data.desconto),
    status: data.status,
    validade: data.validade || null,
    servicos: Array.isArray(data.servicos) ? data.servicos : [],
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    followUpTime: data.followUpTime || null,
    anexos: [],
  }
}

async function ensureBaseSchema() {
  await ensureCrmRuntimeSchema()
  await syncDueFollowUpStatuses()
}

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

async function validateResponsavel(responsavelId: string | null, sessionUser: any) {
  const resolvedId =
    sessionUser.role === 'admin' || sessionUser.role === 'gerente' ? responsavelId : sessionUser.id

  if (!resolvedId) {
    throw new Error('Selecione um vendedor responsavel para a proposta.')
  }

  const [responsavel] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [resolvedId]
  )

  if (!responsavel || !responsavel.ativo || !['vendedor', 'gerente'].includes(responsavel.role)) {
    throw new Error('O responsavel informado para a proposta e invalido.')
  }

  return responsavel.id as string
}

async function validateOrcamentista(orcamentistaId: string | null) {
  if (!orcamentistaId) {
    return null
  }

  const [orcamentista] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [orcamentistaId]
  )

  if (!orcamentista || !orcamentista.ativo || orcamentista.role !== 'orcamentista') {
    throw new Error('O orcamentista informado para a proposta e invalido.')
  }

  return orcamentista.id as string
}

async function persistProposalComment(propostaId: string, usuarioId: string, comentario: string) {
  const cleaned = comentario.trim()
  if (!cleaned) {
    return
  }

  await query(
    `INSERT INTO proposta_comentarios (id, proposta_id, usuario_id, comentario)
     VALUES (?, ?, ?, ?)`,
    [uuidv4(), propostaId, usuarioId, cleaned]
  )
}

async function findReusableSeedProposal(clienteId: string) {
  const [proposal] = await query<any[]>(
    `SELECT p.id, p.numero
     FROM propostas p
     LEFT JOIN proposta_anexos pa ON pa.proposta_id = p.id
     LEFT JOIN proposta_comentarios pc ON pc.proposta_id = p.id
     WHERE p.cliente_id = ?
       AND p.status = 'novo_cliente'
       AND COALESCE(p.valor, 0) <= 0
       AND (p.descricao IS NULL OR TRIM(p.descricao) = '')
       AND p.titulo LIKE 'Novo cliente - %'
     GROUP BY p.id, p.numero, p.created_at
     HAVING COUNT(DISTINCT pa.id) = 0 AND COUNT(DISTINCT pc.id) = 0
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [clienteId]
  )

  return proposal || null
}

export async function GET(request: NextRequest) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const clienteId = searchParams.get('cliente_id')

    let sql = `
      SELECT
        p.*,
        c.nome as cliente_nome,
        u.nome as responsavel_nome,
        o.nome as orcamentista_nome,
        COALESCE(pa.anexos_count, 0) as anexos_count,
        COALESCE(pc.comentarios_count, 0) as comentarios_count
      FROM propostas p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN usuarios u ON p.responsavel_id = u.id
      LEFT JOIN usuarios o ON p.orcamentista_id = o.id
      LEFT JOIN (
        SELECT proposta_id, COUNT(*) as anexos_count
        FROM proposta_anexos
        GROUP BY proposta_id
      ) pa ON pa.proposta_id = p.id
      LEFT JOIN (
        SELECT proposta_id, COUNT(*) as comentarios_count
        FROM proposta_comentarios
        GROUP BY proposta_id
      ) pc ON pc.proposta_id = p.id
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND p.status = ?'
      params.push(status)
    }

    if (clienteId) {
      sql += ' AND p.cliente_id = ?'
      params.push(clienteId)
    }

    if (user.role === 'vendedor') {
      sql += ` AND p.responsavel_id = ?
               AND p.status IN ('enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido')`
      params.push(user.id)
    } else if (user.role === 'orcamentista') {
      sql += ` AND p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
               AND (p.orcamentista_id = ? OR p.orcamentista_id IS NULL OR p.orcamentista_id = '')`
      params.push(user.id)
    }

    sql += ' ORDER BY p.created_at DESC'

    const propostas = await query(sql, params)
    return NextResponse.json(propostas)
  } catch (error) {
    console.error('Erro ao buscar propostas:', error)
    return NextResponse.json({ error: 'Erro ao buscar propostas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    if (user.role === 'orcamentista') {
      return NextResponse.json({ error: 'Orcamentistas nao podem criar propostas' }, { status: 403 })
    }

    const data = await parseProposalPayload(request)
    const id = uuidv4()
    const now = new Date()
    const status = normalizeProposalStatus(data.status)
    const responsavelId = await validateResponsavel(data.responsavelId || null, user)
    const orcamentistaId = await validateOrcamentista(data.orcamentistaId || null)
    const [cliente] = await query<any[]>('SELECT id, nome FROM clientes WHERE id = ? LIMIT 1', [data.clienteId])

    if (!cliente) {
      return NextResponse.json({ error: 'Cliente nao encontrado para a proposta' }, { status: 404 })
    }

    if (requiresOrcamentistaAssignment(status) && !orcamentistaId) {
      return NextResponse.json(
        { error: 'Selecione um orcamentista para iniciar o fluxo comercial da proposta.' },
        { status: 400 }
      )
    }

    const valor = parseNumberLike(data.valor) ?? 0
    const desconto = parseNumberLike(data.desconto) ?? 0
    const valorFinal = valor - (valor * desconto) / 100

    if (status === 'aguardando_aprovacao' && !data.anexos.some(isPdfFile)) {
      return NextResponse.json(
        { error: 'Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.' },
        { status: 400 }
      )
    }

    if (requiresPositiveProposalValue(status) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

    const reusableSeedProposal = await findReusableSeedProposal(data.clienteId)
    const propostaId = reusableSeedProposal?.id || id
    const numero =
      reusableSeedProposal?.numero ||
      (await insertProposalWithUniqueNumber({
        id: propostaId,
        clienteId: data.clienteId,
        responsavelId,
        orcamentistaId,
        titulo: data.titulo || 'Proposta Comercial',
        descricao: data.descricao || null,
        valor,
        desconto,
        valorFinal,
        status,
        validade: data.validade || null,
        servicos: data.servicos || [],
        condicoes: data.condicoes || null,
        now,
        followUpTime: data.followUpTime || null,
      }))

    if (reusableSeedProposal) {
      await query(
        `UPDATE propostas SET
          cliente_id = ?, responsavel_id = ?, orcamentista_id = ?, titulo = ?, descricao = ?,
          valor = ?, desconto = ?, valor_final = ?, status = ?, validade = ?, servicos = ?,
          condicoes = ?, follow_up_base_at = ?, follow_up_time = ?
         WHERE id = ?`,
        [
          data.clienteId,
          responsavelId,
          orcamentistaId,
          data.titulo || 'Proposta Comercial',
          data.descricao || null,
          valor,
          desconto,
          valorFinal,
          status,
          data.validade || null,
          JSON.stringify(data.servicos || []),
          data.condicoes || null,
          status === 'enviado_ao_cliente' ? formatDateTime(now) : null,
          data.followUpTime || null,
          propostaId,
        ]
      )
    }

    if (data.comentario?.trim()) {
      await persistProposalComment(propostaId, user.id, data.comentario)
    }

    const savedFiles = await saveProposalFiles(propostaId, data.anexos)
    for (const file of savedFiles) {
      await query(
        `INSERT INTO proposta_anexos (
          id, proposta_id, nome_original, nome_arquivo, caminho, tipo_mime, tamanho, usuario_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          file.id,
          propostaId,
          file.nomeOriginal,
          file.nomeArquivo,
          file.caminho,
          file.tipoMime,
          file.tamanho,
          user.id,
        ]
      )
    }

    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
       VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
      [
        uuidv4(),
        data.clienteId,
        user.id,
        `Proposta ${numero} criada em ${status}`,
        JSON.stringify({ proposta_id: propostaId, status, silent_notification: true }),
        formatDateTime(now),
      ]
    )

    await handleProposalAutomationOnCreate({
      clienteId: data.clienteId,
      clienteNome: cliente.nome,
      responsavelId,
      orcamentistaId,
      propostaId,
      status,
      createdAt: now,
      followUpBaseAt: status === 'enviado_ao_cliente' ? now : null,
      followUpTime: data.followUpTime || null,
    })

    invalidateRuntimeCache('crm-bootstrap:')
    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'proposta',
      resourceId: propostaId,
    })

    const [proposta] = await query<any[]>('SELECT * FROM propostas WHERE id = ?', [propostaId])
    return NextResponse.json(proposta, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar proposta:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao criar proposta' },
      { status: 500 }
    )
  }
}
