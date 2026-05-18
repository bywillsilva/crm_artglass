import { NextResponse } from 'next/server'
import { isTransientDatabaseError, logDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { jsonNoStore } from '@/lib/server/http-cache'
import { normalizeJsonPayload } from '@/lib/server/json-normalize'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { ensureProposalReadSideReady, ensureSchemaReadyForReads } from '@/lib/server/read-side-maintenance'

type AuthenticatedUser = {
  id: string
  role: string
  ativo: boolean
  rulePermissions?: unknown
}

const CRM_BOOTSTRAP_CACHE_TTL_MS = Math.max(
  Number(process.env.CRM_BOOTSTRAP_CACHE_TTL_MS || 30_000),
  1000
)

const SELLER_VISIBLE_STATUSES = [
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'aguardando_follow_up_3_dias',
  'follow_up_3_dias',
  'aguardando_follow_up_7_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'pos_fechamento',
  'perdido',
] as const

const BOOTSTRAP_SECTIONS = ['clientes', 'usuarios', 'tarefas', 'propostas'] as const
type BootstrapSection = (typeof BOOTSTRAP_SECTIONS)[number]

const BOOTSTRAP_CLIENT_SELECT_COLUMNS = `
  c.id,
  c.nome,
  c.cpf,
  c.telefone,
  c.email,
  c.empresa,
  c.cargo,
  c.tipo,
  c.endereco,
  c.numero,
  c.bairro,
  c.cidade,
  c.estado,
  c.cep,
  c.origem,
  c.observacoes,
  c.status_funil,
  c.responsavel_id,
  c.created_at,
  c.updated_at
`

const BOOTSTRAP_TASK_SELECT_COLUMNS = `
  t.id,
  t.titulo,
  t.descricao,
  t.tipo,
  t.data_hora,
  t.status,
  t.cliente_id,
  t.responsavel_id,
  t.proposta_id,
  t.automacao_etapa,
  t.origem,
  t.created_at,
  t.updated_at,
  COALESCE(t.cliente_id, p.cliente_id) as cliente_id_resolvido
`

const BOOTSTRAP_PROPOSAL_SELECT_COLUMNS = `
  p.id,
  p.numero,
  p.cliente_id,
  p.responsavel_id,
  p.orcamentista_id,
  p.retificacoes_count,
  p.titulo,
  p.material_tag,
  p.area_m2,
  p.perfis_bruto,
  p.perfis_liquidos,
  p.valor_perfil,
  p.valor_vidro,
  p.valor_acessorios,
  p.observacoes_tecnicas,
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  p.pos_fechamento_contrato_feito_at,
  p.pos_fechamento_contrato_enviado_at,
  p.pos_fechamento_aguardando_pagamento_at,
  p.pos_fechamento_pagamento_confirmado_at,
  p.pos_fechamento_aguardando_os_at,
  p.pos_fechamento_ordem_servico_liberada_at,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome,
  COALESCE(pa.anexos_count, 0) as anexos_count,
  COALESCE(pc.comentarios_count, 0) as comentarios_count
`

const BOOTSTRAP_PROPOSAL_SELECT_COLUMNS_LEGACY = `
  p.id,
  p.numero,
  p.cliente_id,
  p.responsavel_id,
  p.orcamentista_id,
  p.retificacoes_count,
  p.titulo,
  p.material_tag,
  NULL as area_m2,
  NULL as perfis_bruto,
  NULL as perfis_liquidos,
  NULL as valor_perfil,
  NULL as valor_vidro,
  NULL as valor_acessorios,
  NULL as observacoes_tecnicas,
  p.descricao,
  p.valor,
  p.desconto,
  p.valor_final,
  p.status,
  p.validade,
  p.follow_up_base_at,
  p.follow_up_time,
  p.kanban_order,
  NULL as pos_fechamento_contrato_feito_at,
  NULL as pos_fechamento_contrato_enviado_at,
  NULL as pos_fechamento_aguardando_pagamento_at,
  NULL as pos_fechamento_pagamento_confirmado_at,
  NULL as pos_fechamento_aguardando_os_at,
  NULL as pos_fechamento_ordem_servico_liberada_at,
  p.created_at,
  p.updated_at,
  c.nome as cliente_nome,
  u.nome as responsavel_nome,
  o.nome as orcamentista_nome,
  COALESCE(pa.anexos_count, 0) as anexos_count,
  COALESCE(pc.comentarios_count, 0) as comentarios_count
`

function parseSectionsParam(request: Request) {
  const url = new URL(request.url)
  const rawSections = url.searchParams.get('sections')

  if (!rawSections) {
    return [...BOOTSTRAP_SECTIONS]
  }

  const requestedSections = rawSections
    .split(',')
    .map((section) => section.trim())
    .filter((section): section is BootstrapSection =>
      BOOTSTRAP_SECTIONS.includes(section as BootstrapSection)
    )

  return requestedSections.length > 0 ? requestedSections : [...BOOTSTRAP_SECTIONS]
}

function isUnknownColumnError(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  const message =
    typeof error === 'object' && error && 'sqlMessage' in error
      ? String((error as any).sqlMessage || '')
      : typeof error === 'object' && error && 'message' in error
        ? String((error as any).message || '')
        : ''

  return code === 'ER_BAD_FIELD_ERROR' || /unknown column/i.test(message)
}

function isTransientBootstrapDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

async function bootstrapQuery<T>(sql: string, params: unknown[] = []) {
  const result = await prisma.$queryRawUnsafe(sql, ...params)
  return normalizeJsonPayload(result) as T
}

async function queryBootstrapUsers() {
  try {
    return await prisma.usuarios.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        avatar: true,
        role: true,
        ativo: true,
        meta_vendas: true,
        module_permissions: true,
        rule_permissions: true,
        created_at: true,
      },
      orderBy: { nome: 'asc' },
    })
  } catch (error) {
    if (!isUnknownColumnError(error)) {
      throw error
    }

    return bootstrapQuery<any[]>(
      `SELECT id, nome, email, avatar, role, ativo, meta_vendas, created_at
       FROM usuarios
       ORDER BY nome ASC`
    )
  }
}

function buildBootstrapProposalQuery(selectColumns: string, whereClause: string) {
  return `SELECT
            ${selectColumns}
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
          WHERE ${whereClause}
          ORDER BY p.created_at DESC`
}

async function queryBootstrapProposals(whereClause: string, params: unknown[]) {
  try {
    return await bootstrapQuery<any[]>(buildBootstrapProposalQuery(BOOTSTRAP_PROPOSAL_SELECT_COLUMNS, whereClause), params)
  } catch (error) {
    if (!isUnknownColumnError(error)) {
      throw error
    }

    return bootstrapQuery<any[]>(
      buildBootstrapProposalQuery(BOOTSTRAP_PROPOSAL_SELECT_COLUMNS_LEGACY, whereClause),
      params
    )
  }
}

export async function GET(request: Request) {
  let isAuthenticated = false

  try {
    await ensureSystemDatabaseSchema()
    await ensureSchemaReadyForReads()
    await ensureProposalReadSideReady()

    const authenticatedUser = await getAuthenticatedServerUser()
    if (!authenticatedUser?.ativo) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    isAuthenticated = true
    const canViewAllClients = hasRuleAccess(authenticatedUser, 'canViewAllClients')
    const canViewAllTasks = hasRuleAccess(authenticatedUser, 'canViewAllTasks')
    const sections = parseSectionsParam(request)
    const cacheKey = `crm-bootstrap:${authenticatedUser.role}:${authenticatedUser.id}:${sections.join(',')}`
    const cachedResponse = getRuntimeCache<Partial<Record<BootstrapSection, any[]>>>(cacheKey)

    if (cachedResponse) {
      return jsonNoStore(cachedResponse)
    }

    const results = await Promise.all(
      sections.map(async (section) => {
        switch (section) {
          case 'clientes':
            const clientWhereClause =
              !canViewAllClients
                ? `WHERE (
                    c.responsavel_id = ?
                    OR EXISTS (
                      SELECT 1
                      FROM propostas p
                      WHERE p.cliente_id = c.id
                        AND p.responsavel_id = ?
                    )
                  )`
                : ''
            return [
              section,
              await bootstrapQuery<any[]>(
                 `SELECT
                    ${BOOTSTRAP_CLIENT_SELECT_COLUMNS}
                   FROM clientes c
                   ${clientWhereClause}
                 ORDER BY c.created_at DESC`,
                 !canViewAllClients
                   ? [authenticatedUser.id, authenticatedUser.id]
                   : []
              ),
            ] as const
          case 'usuarios':
            return [
              section,
              await queryBootstrapUsers(),
            ] as const
          case 'tarefas':
            return [
              section,
              await bootstrapQuery<any[]>(
                 `SELECT
                   ${BOOTSTRAP_TASK_SELECT_COLUMNS}
                 FROM tarefas t
                 LEFT JOIN propostas p ON t.proposta_id = p.id
                  WHERE ${canViewAllTasks ? '1=1' : 't.responsavel_id = ?'}
                  ORDER BY t.data_hora ASC`,
                 canViewAllTasks ? [] : [authenticatedUser.id]
               ),
            ] as const
          case 'propostas':
            const proposalWhereClause =
              authenticatedUser.role === 'vendedor'
                ? hasRuleAccess(authenticatedUser, 'allowSellerViewReleasedProposals')
                  ? `p.responsavel_id = ? AND p.status IN (${SELLER_VISIBLE_STATUSES.map(() => '?').join(', ')})`
                  : '1=0'
                : authenticatedUser.role === 'orcamentista'
                  ? hasRuleAccess(authenticatedUser, 'allowOrcamentistaViewAssignedProposalsOutsideScope')
                    ? `(p.orcamentista_id = ?
                        OR (
                          p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
                          AND (p.orcamentista_id IS NULL OR p.orcamentista_id = '')
                        ))`
                    : `(
                        p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
                        AND (p.orcamentista_id IS NULL OR p.orcamentista_id = '' OR p.orcamentista_id = ?)
                      )`
                  : '1=1'
            const proposalParams =
              authenticatedUser.role === 'vendedor'
                ? hasRuleAccess(authenticatedUser, 'allowSellerViewReleasedProposals')
                  ? [authenticatedUser.id, ...SELLER_VISIBLE_STATUSES]
                  : []
                : authenticatedUser.role === 'orcamentista'
                  ? [authenticatedUser.id]
                : []
            return [
              section,
              await queryBootstrapProposals(proposalWhereClause, proposalParams),
            ] as const
        }
      })
    )

    const payload = Object.fromEntries(results) as Partial<Record<BootstrapSection, any[]>>

    setRuntimeCache(cacheKey, payload, CRM_BOOTSTRAP_CACHE_TTL_MS)
    return jsonNoStore(payload)
  } catch (error) {
    if (!isTransientBootstrapDatabaseError(error)) {
      logDatabaseError('Erro ao carregar bootstrap do CRM', error)
    }

    if (isAuthenticated) {
      const authenticatedUser = await getAuthenticatedServerUser().catch(() => null)
      const sections = parseSectionsParam(request)
      if (authenticatedUser?.ativo) {
        const cacheKey = `crm-bootstrap:${authenticatedUser.role}:${authenticatedUser.id}:${sections.join(',')}`
        const cachedResponse = getRuntimeCache<Partial<Record<BootstrapSection, any[]>>>(cacheKey)
        if (cachedResponse) {
          return jsonNoStore(cachedResponse)
        }
      }

      return jsonNoStore(
        { error: 'Bootstrap do CRM temporariamente indisponivel', degraded: true },
        { status: 503 }
      )
    }

    return jsonNoStore({ error: 'Erro ao carregar bootstrap do CRM' }, { status: 500 })
  }
}
