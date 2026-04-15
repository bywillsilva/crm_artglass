import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { deleteStoredFiles, saveProposalFiles } from '@/lib/server/proposal-files'
import {
  canOrcamentistaAccessProposal,
  ensureClientSchema,
  ensureProposalStatusSchema,
  ensureResponsibilityIntegrity,
  ensureTaskSchema,
  ensureUserRoleSchema,
  formatDateTime,
  normalizeProposalStatus,
  parseDatabaseDateTime,
  requiresOrcamentistaAssignment,
  requiresPositiveProposalValue,
  syncDueFollowUpStatuses,
  syncProposalAutomation,
  type ProposalWorkflowStatus,
} from '@/lib/server/proposal-workflow'

type ProposalPayload = {
  titulo?: string
  descricao?: string
  valor?: number
  desconto?: number
  status?: string
  validade?: string | null
  servicos?: unknown[]
  condicoes?: string | null
  responsavelId?: string | null
  orcamentistaId?: string | null
  comentario?: string | null
  followUpTime?: string | null
  clienteId?: string
  anexos: File[]
}

const SELLER_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  enviar_ao_cliente: ['enviado_ao_cliente'],
  enviado_ao_cliente: ['follow_up_1_dia', 'em_retificacao', 'perdido', 'stand_by'],
  follow_up_1_dia: ['aguardando_follow_up_3_dias', 'fechado', 'perdido', 'stand_by', 'em_retificacao'],
  follow_up_3_dias: ['aguardando_follow_up_7_dias', 'fechado', 'perdido', 'stand_by', 'em_retificacao'],
  follow_up_7_dias: ['fechado', 'perdido', 'stand_by', 'em_retificacao'],
  stand_by: ['follow_up_1_dia', 'aguardando_follow_up_3_dias', 'aguardando_follow_up_7_dias', 'em_retificacao', 'fechado', 'perdido'],
}

const ORCAMENTISTA_ALLOWED_TRANSITIONS: Partial<Record<ProposalWorkflowStatus, ProposalWorkflowStatus[]>> = {
  novo_cliente: ['em_orcamento'],
  em_orcamento: ['aguardando_aprovacao', 'em_retificacao'],
  em_retificacao: ['aguardando_aprovacao', 'em_orcamento'],
}

async function ensureBaseSchema() {
  await ensureUserRoleSchema()
  await ensureClientSchema()
  await ensureProposalStatusSchema()
  await ensureTaskSchema()
  await ensureResponsibilityIntegrity()
  await syncDueFollowUpStatuses()
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
      titulo: String(formData.get('titulo') || '') || undefined,
      descricao: String(formData.get('descricao') || '') || undefined,
      valor: formData.get('valor') ? Number(formData.get('valor')) : undefined,
      desconto: formData.get('desconto') ? Number(formData.get('desconto')) : undefined,
      status: String(formData.get('status') || '') || undefined,
      validade: String(formData.get('validade') || '') || null,
      servicos: parseJsonValue(formData.get('servicos'), [] as unknown[]),
      condicoes: String(formData.get('condicoes') || '') || null,
      responsavelId: String(formData.get('responsavelId') || '') || null,
      orcamentistaId: String(formData.get('orcamentistaId') || '') || null,
      comentario: String(formData.get('comentario') || '') || null,
      followUpTime: String(formData.get('followUpTime') || '') || null,
      clienteId: String(formData.get('clienteId') || '') || undefined,
      anexos: formData
        .getAll('anexos')
        .filter((value): value is File => value instanceof File && value.size > 0),
    }
  }

  const data = await request.json()
  return {
    titulo: data.titulo,
    descricao: data.descricao,
    valor: data.valor === undefined ? undefined : Number(data.valor),
    desconto: data.desconto === undefined ? undefined : Number(data.desconto),
    status: data.status,
    validade: data.validade || null,
    servicos: Array.isArray(data.servicos) ? data.servicos : undefined,
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    followUpTime: data.followUpTime || null,
    clienteId: data.clienteId,
    anexos: [],
  }
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

async function getProposal(id: string) {
  const [proposta] = await query<any[]>(
    `SELECT p.*, c.nome as cliente_nome, u.nome as responsavel_nome, o.nome as orcamentista_nome
     FROM propostas p
     LEFT JOIN clientes c ON p.cliente_id = c.id
     LEFT JOIN usuarios u ON p.responsavel_id = u.id
     LEFT JOIN usuarios o ON p.orcamentista_id = o.id
     WHERE p.id = ?`,
    [id]
  )

  return proposta
}

function canViewProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') return proposta.responsavel_id === user.id
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
  }
  return false
}

function canEditProposal(user: any, proposta: any) {
  if (user.role === 'admin' || user.role === 'gerente') return true
  if (user.role === 'vendedor') return proposta.responsavel_id === user.id
  if (user.role === 'orcamentista') {
    return canOrcamentistaAccessProposal(proposta, user.id)
  }
  return false
}

function isTransitionAllowed(user: any, currentStatus: ProposalWorkflowStatus, nextStatus: ProposalWorkflowStatus) {
  if (user.role === 'admin' || user.role === 'gerente') {
    return true
  }

  if (user.role === 'vendedor') {
    return SELLER_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? currentStatus === nextStatus
  }

  if (user.role === 'orcamentista') {
    return ORCAMENTISTA_ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? currentStatus === nextStatus
  }

  return false
}

async function validateUserRole(id: string | null, allowedRoles: string[]) {
  if (!id) {
    return null
  }

  const [user] = await query<any[]>(
    'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [id]
  )

  if (!user || !user.ativo || !allowedRoles.includes(user.role)) {
    throw new Error('Usuario informado para a proposta e invalido.')
  }

  return user.id as string
}

async function persistProposalComment(propostaId: string, usuarioId: string, comentario: string) {
  const cleaned = comentario.trim()
  if (!cleaned) return

  await query(
    `INSERT INTO proposta_comentarios (id, proposta_id, usuario_id, comentario)
     VALUES (?, ?, ?, ?)`,
    [uuidv4(), propostaId, usuarioId, cleaned]
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const proposta = await getProposal(id)

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canViewProposal(user, proposta)) {
      return NextResponse.json({ error: 'Acesso negado a esta proposta' }, { status: 403 })
    }

    const anexos = await query<any[]>(
      `SELECT id, usuario_id, nome_original, tipo_mime, tamanho, created_at,
              CONCAT('/uploads/propostas/', proposta_id, '/', nome_arquivo) as url
       FROM proposta_anexos
       WHERE proposta_id = ?
       ORDER BY created_at DESC`,
      [id]
    )

    const comentarios = await query<any[]>(
      `SELECT pc.id, pc.proposta_id, pc.usuario_id, pc.comentario, pc.created_at, u.nome as usuario_nome
       FROM proposta_comentarios pc
       LEFT JOIN usuarios u ON u.id = pc.usuario_id
       WHERE pc.proposta_id = ?
       ORDER BY pc.created_at DESC`,
      [id]
    )

    return NextResponse.json({
      ...proposta,
      anexos,
      comentarios,
    })
  } catch (error) {
    console.error('Erro ao buscar proposta:', error)
    return NextResponse.json({ error: 'Erro ao buscar proposta' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await parseProposalPayload(request)
    const propostaAtual = await getProposal(id)

    if (!propostaAtual) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canEditProposal(user, propostaAtual)) {
      return NextResponse.json(
        { error: 'Voce nao tem permissao para editar esta proposta' },
        { status: 403 }
      )
    }

    const previousStatus = normalizeProposalStatus(propostaAtual.status)
    const nextStatus = normalizeProposalStatus(data.status ?? propostaAtual.status)

    if (!isTransitionAllowed(user, previousStatus, nextStatus)) {
      return NextResponse.json(
        { error: 'Voce nao pode mover esta proposta para a etapa selecionada.' },
        { status: 403 }
      )
    }

    if (
      user.role === 'vendedor' &&
      ['follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias'].includes(previousStatus) &&
      nextStatus !== previousStatus &&
      !data.comentario?.trim()
    ) {
      return NextResponse.json(
        { error: 'Informe um comentario de status antes de avancar o follow-up.' },
        { status: 400 }
      )
    }

    if (previousStatus === 'aguardando_aprovacao' && nextStatus === 'enviar_ao_cliente' && !['admin', 'gerente'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Apenas administradores podem aprovar o orcamento pronto.' },
        { status: 403 }
      )
    }

    const responsavelId =
      user.role === 'admin' || user.role === 'gerente'
        ? await validateUserRole(data.responsavelId || propostaAtual.responsavel_id, ['vendedor', 'gerente'])
        : propostaAtual.responsavel_id
    const requestedOrcamentistaId =
      data.orcamentistaId === undefined ? propostaAtual.orcamentista_id : data.orcamentistaId
    const resolvedOrcamentistaId =
      user.role === 'orcamentista' &&
      !requestedOrcamentistaId &&
      requiresOrcamentistaAssignment(nextStatus)
        ? user.id
        : requestedOrcamentistaId
    const orcamentistaId = await validateUserRole(resolvedOrcamentistaId, ['orcamentista'])

    if (requiresOrcamentistaAssignment(nextStatus) && !orcamentistaId) {
      return NextResponse.json(
        { error: 'Selecione um orcamentista para seguir com esta etapa da proposta.' },
        { status: 400 }
      )
    }

    const storedStatus =
      previousStatus === 'follow_up_1_dia' && nextStatus === 'follow_up_3_dias'
        ? 'aguardando_follow_up_3_dias'
        : previousStatus === 'follow_up_3_dias' && nextStatus === 'follow_up_7_dias'
          ? 'aguardando_follow_up_7_dias'
          : nextStatus

    const valor = Number(data.valor ?? propostaAtual.valor ?? 0)
    const desconto = Number(data.desconto ?? propostaAtual.desconto ?? 0)
    const valorFinal = valor - (valor * desconto) / 100
    const resolvedClienteId = data.clienteId || propostaAtual.cliente_id

    if (requiresPositiveProposalValue(storedStatus) && valor <= 0) {
      return NextResponse.json(
        { error: 'Informe o valor do orcamento antes de avancar esta proposta.' },
        { status: 400 }
      )
    }

    const servicos =
      Array.isArray(data.servicos)
        ? data.servicos
        : typeof propostaAtual.servicos === 'string'
          ? JSON.parse(propostaAtual.servicos || '[]')
          : propostaAtual.servicos || []

    const changedAt = new Date()
    const currentFollowUpBaseAt = parseDatabaseDateTime(propostaAtual.follow_up_base_at)
    const shouldResetFollowUpBase =
      previousStatus !== storedStatus && storedStatus === 'enviado_ao_cliente'
    const followUpBaseAt =
      shouldResetFollowUpBase
        ? changedAt
        : currentFollowUpBaseAt || (
            ['follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias'].includes(storedStatus)
              ? changedAt
              : null
          )
    const followUpTime = data.followUpTime ?? propostaAtual.follow_up_time ?? null

    await query(
      `UPDATE propostas SET
        cliente_id = ?, titulo = ?, descricao = ?, valor = ?, desconto = ?,
        valor_final = ?, status = ?, validade = ?, servicos = ?, condicoes = ?,
        responsavel_id = ?, orcamentista_id = ?, follow_up_base_at = ?, follow_up_time = ?
       WHERE id = ?`,
      [
        resolvedClienteId,
        data.titulo || propostaAtual.titulo || 'Proposta Comercial',
        data.descricao ?? propostaAtual.descricao ?? null,
        valor,
        desconto,
        valorFinal,
        storedStatus,
        data.validade || propostaAtual.validade || null,
        JSON.stringify(servicos),
        data.condicoes ?? propostaAtual.condicoes ?? null,
        responsavelId,
        orcamentistaId,
        followUpBaseAt ? formatDateTime(followUpBaseAt) : null,
        followUpTime,
        id,
      ]
    )

    const savedFilesPromise = saveProposalFiles(id, data.anexos)
    const commentPromise = data.comentario?.trim()
      ? persistProposalComment(id, user.id, data.comentario)
      : Promise.resolve()
    const clientePromise =
      previousStatus !== storedStatus && resolvedClienteId !== propostaAtual.cliente_id
        ? query<any[]>('SELECT nome FROM clientes WHERE id = ? LIMIT 1', [resolvedClienteId])
        : Promise.resolve([{ nome: propostaAtual.cliente_nome || 'cliente' }])

    const [savedFiles, clienteRows] = await Promise.all([
      savedFilesPromise,
      clientePromise,
      commentPromise,
    ])

    if (savedFiles.length > 0) {
      await Promise.all(
        savedFiles.map((file) =>
          query(
            `INSERT INTO proposta_anexos (
              id, proposta_id, nome_original, nome_arquivo, caminho, tipo_mime, tamanho, usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [file.id, id, file.nomeOriginal, file.nomeArquivo, file.caminho, file.tipoMime, file.tamanho, user.id]
          )
        )
      )
    }

    const cliente = clienteRows[0]

    if (previousStatus !== storedStatus) {
      await Promise.all([
        query(
          `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
           VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
          [
            uuidv4(),
            resolvedClienteId,
            user.id,
            `Proposta ${propostaAtual.numero} alterada para ${storedStatus}`,
            JSON.stringify({
              proposta_id: id,
              novo_status: storedStatus,
              notification_kind: 'proposal_status',
            }),
            formatDateTime(changedAt),
          ]
        ),
        syncProposalAutomation({
          propostaId: id,
          clienteId: resolvedClienteId,
          clienteNome: cliente?.nome || propostaAtual.cliente_nome || 'cliente',
          responsavelId,
          orcamentistaId,
          previousStatus,
          newStatus: storedStatus,
          changedAt,
          followUpBaseAt,
          followUpTime,
        }),
      ])
    } else {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
        [
          uuidv4(),
          resolvedClienteId,
          user.id,
          `Proposta ${propostaAtual.numero} atualizada`,
          JSON.stringify({
            proposta_id: id,
            origem: 'edicao_proposta',
            silent_notification: true,
          }),
          formatDateTime(changedAt),
        ]
      )
    }

    const proposta = await getProposal(id)
    return NextResponse.json(proposta)
  } catch (error) {
    console.error('Erro ao atualizar proposta:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao atualizar proposta' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureBaseSchema()

    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const proposta = await getProposal(id)

    if (!proposta) {
      return NextResponse.json({ error: 'Proposta nao encontrada' }, { status: 404 })
    }

    if (!canEditProposal(user, proposta)) {
      return NextResponse.json({ error: 'Voce nao pode excluir esta proposta' }, { status: 403 })
    }

    const anexos = await query<any[]>(
      'SELECT caminho FROM proposta_anexos WHERE proposta_id = ?',
      [id]
    )

    await query('DELETE FROM proposta_anexos WHERE proposta_id = ?', [id])
    await query('DELETE FROM proposta_comentarios WHERE proposta_id = ?', [id])
    await query(`DELETE FROM tarefas WHERE proposta_id = ? AND origem = 'automacao_proposta'`, [id])
    await query('DELETE FROM propostas WHERE id = ?', [id])

    await deleteStoredFiles(anexos.map((item) => item.caminho))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar proposta:', error)
    return NextResponse.json({ error: 'Erro ao deletar proposta' }, { status: 500 })
  }
}
