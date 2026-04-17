import { NextResponse } from 'next/server'
import { isTransientDatabaseError, logDatabaseError, query } from '@/lib/db/mysql'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

type AuthenticatedUser = {
  id: string
  role: string
  ativo: boolean
}

const CRM_BOOTSTRAP_CACHE_TTL_MS = Math.max(
  Number(process.env.CRM_BOOTSTRAP_CACHE_TTL_MS || 30_000),
  1000
)

const BOOTSTRAP_SECTIONS = ['clientes', 'usuarios', 'tarefas', 'propostas'] as const
type BootstrapSection = (typeof BOOTSTRAP_SECTIONS)[number]

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

export async function GET(request: Request) {
  let isAuthenticated = false

  try {
    const authenticatedUser = await getAuthenticatedServerUser()
    if (!authenticatedUser?.ativo) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    isAuthenticated = true

    const isAdmin = authenticatedUser.role === 'admin' || authenticatedUser.role === 'gerente'
    const sections = parseSectionsParam(request)
    const cacheKey = `crm-bootstrap:${authenticatedUser.role}:${authenticatedUser.id}:${sections.join(',')}`
    const cachedResponse = getRuntimeCache<Partial<Record<BootstrapSection, any[]>>>(cacheKey)

    if (cachedResponse) {
      return NextResponse.json(cachedResponse)
    }

    const results = await Promise.all(
      sections.map(async (section) => {
        switch (section) {
          case 'clientes':
            return [
              section,
              await query<any[]>(
                 `SELECT
                    c.id,
                    c.nome,
                    c.cpf,
                    c.telefone,
                    c.email,
                    c.empresa,
                   c.cargo,
                   c.endereco,
                   c.cidade,
                   c.estado,
                    c.cep,
                    c.origem,
                    c.observacoes,
                    c.status_funil,
                    c.created_at,
                    c.updated_at
                  FROM clientes c
                 ORDER BY c.created_at DESC`
              ),
            ] as const
          case 'usuarios':
            return [
              section,
              await query<any[]>(
                `SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at
                 FROM usuarios
                 ORDER BY nome ASC`
              ),
            ] as const
          case 'tarefas':
            return [
              section,
              await query<any[]>(
                `SELECT
                   t.*,
                   COALESCE(t.cliente_id, p.cliente_id) as cliente_id_resolvido,
                   c.nome as cliente_nome,
                   u.nome as responsavel_nome
                 FROM tarefas t
                 LEFT JOIN propostas p ON t.proposta_id = p.id
                 LEFT JOIN clientes c ON COALESCE(t.cliente_id, p.cliente_id) = c.id
                 LEFT JOIN usuarios u ON t.responsavel_id = u.id
                 WHERE ${isAdmin ? '1=1' : 't.responsavel_id = ?'}
                 ORDER BY t.data_hora ASC`,
                isAdmin ? [] : [authenticatedUser.id]
              ),
            ] as const
          case 'propostas':
            return [
              section,
              await query<any[]>(
                `SELECT
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
                 WHERE ${
                    authenticatedUser.role === 'vendedor'
                      ? `p.responsavel_id = ?
                         AND p.status IN ('enviar_ao_cliente', 'enviado_ao_cliente', 'follow_up_1_dia', 'aguardando_follow_up_3_dias', 'follow_up_3_dias', 'aguardando_follow_up_7_dias', 'follow_up_7_dias', 'stand_by', 'fechado', 'perdido')`
                      : authenticatedUser.role === 'orcamentista'
                        ? `p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
                           AND (p.orcamentista_id = ? OR p.orcamentista_id IS NULL OR p.orcamentista_id = '')`
                       : '1=1'
                 }
                 ORDER BY p.created_at DESC`,
                authenticatedUser.role === 'vendedor' || authenticatedUser.role === 'orcamentista'
                  ? [authenticatedUser.id]
                  : []
              ),
            ] as const
        }
      })
    )

    const payload = Object.fromEntries(results) as Partial<Record<BootstrapSection, any[]>>

    setRuntimeCache(cacheKey, payload, CRM_BOOTSTRAP_CACHE_TTL_MS)
    return NextResponse.json(payload)
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      logDatabaseError('Erro ao carregar bootstrap do CRM', error)
    }

    if (isAuthenticated) {
      const sections = parseSectionsParam(request)
      const payload = Object.fromEntries(
        sections.map((section) => [section, []])
      ) as Partial<Record<BootstrapSection, any[]>>
      return NextResponse.json({ ...payload, degraded: true })
    }

    return NextResponse.json({ error: 'Erro ao carregar bootstrap do CRM' }, { status: 500 })
  }
}
