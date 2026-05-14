import { NextRequest, NextResponse } from 'next/server'
import { getConnection, isTransientDatabaseError, query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { jsonNoStore } from '@/lib/server/http-cache'
import { syncNormalizedUserPermissions } from '@/lib/server/user-permissions-store'

const USUARIOS_CACHE_TTL_MS = Math.max(Number(process.env.USUARIOS_CACHE_TTL_MS || 30_000), 1000)

function canAccessUsuariosModule(user: { role?: string | null; modulePermissions?: unknown }) {
  return hasModuleAccess(
    {
      role: user.role,
      modulePermissions: user.modulePermissions as Record<string, boolean> | null | undefined,
    },
    'usuarios'
  )
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const role = searchParams.get('role')
  const ativo = searchParams.get('ativo')

  try {
    await ensureSystemDatabaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
    }
    if (!canAccessUsuariosModule(user)) {
      return jsonNoStore({ error: 'Acesso negado ao modulo de usuarios' }, { status: 403 })
    }

    const cacheKey = `usuarios:list:${user.id}:${user.role}:${role || 'todos'}:${ativo || 'todos'}`

    const cachedUsuarios = getRuntimeCache<any[]>(cacheKey)
    if (cachedUsuarios !== undefined) {
      return jsonNoStore(cachedUsuarios)
    }

    let sql =
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, rule_permissions, created_at FROM usuarios WHERE 1=1'
    const params: unknown[] = []

    if (role && role !== 'todos') {
      sql += ' AND role = ?'
      params.push(role)
    }

    if (ativo !== null && ativo !== 'todos') {
      sql += ' AND ativo = ?'
      params.push(ativo === 'true')
    }

    sql += ' ORDER BY nome ASC'

    const usuarios = await query(sql, params)
    setRuntimeCache(cacheKey, usuarios, USUARIOS_CACHE_TTL_MS)
    return jsonNoStore(usuarios)
  } catch (error: any) {
    console.error('Erro ao buscar usuarios:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return jsonNoStore({ error: 'Nao autenticado' }, { status: 401 })
      }
      const cacheKey = `usuarios:list:${user.id}:${user.role}:${role || 'todos'}:${ativo || 'todos'}`
      const cachedUsuarios = getRuntimeCache<any[]>(cacheKey)
      if (cachedUsuarios) {
        return jsonNoStore(cachedUsuarios)
      }

      return jsonNoStore(
        { error: 'Lista de usuarios temporariamente indisponivel', degraded: true },
        { status: 503 }
      )
    }

    return jsonNoStore({ error: 'Erro ao buscar usuarios' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemDatabaseSchema()
    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    if (!canAccessUsuariosModule(user)) {
      return NextResponse.json({ error: 'Acesso negado ao modulo de usuarios' }, { status: 403 })
    }

    const data = await request.json()
    const id = uuidv4()

    if (typeof data.senha !== 'string' || data.senha.trim().length < 8) {
      return NextResponse.json(
        { error: 'Senha obrigatoria com no minimo 8 caracteres' },
        { status: 400 }
      )
    }

    const senhaHash = await bcrypt.hash(data.senha, 10)
    const modulePermissions = normalizeModulePermissions(data.modulePermissions, data.role || 'vendedor')
    const rulePermissions = normalizeRulePermissions(data.rulePermissions, data.role || 'vendedor')

    const iniciais = data.nome
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    const connection = await getConnection()
    let usuario: any

    try {
      await connection.beginTransaction()

      await connection.execute(
        `INSERT INTO usuarios (id, nome, email, senha, avatar, role, ativo, meta_vendas, module_permissions, rule_permissions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.nome,
          data.email,
          senhaHash,
          iniciais,
          data.role || 'vendedor',
          data.ativo ?? true,
          parseNullableNumber(data.metaVendas ?? data.meta_vendas, 0),
          JSON.stringify(modulePermissions),
          JSON.stringify(rulePermissions),
        ]
      )

      await syncNormalizedUserPermissions(
        {
          userId: id,
          role: (data.role || 'vendedor'),
          modulePermissions,
          rulePermissions,
        },
        connection
      )

      const [rows] = await connection.execute(
        'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, rule_permissions, created_at FROM usuarios WHERE id = ?',
        [id]
      )
      ;[usuario] = rows as any[]

      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: 'usuario',
      resourceId: id,
    })
    invalidateRuntimeCache('usuarios:list:')
    invalidateRuntimeCache('usuario:detail:')
    invalidateRuntimeCache('clientes:list:')
    invalidateRuntimeCache('cliente:detail:')
    invalidateRuntimeCache('propostas:list:')
    invalidateRuntimeCache('proposta:detail:')
    invalidateRuntimeCache('tarefas:list:')
    invalidateRuntimeCache('tarefa:detail:')
    invalidateRuntimeCache('dashboard:')
    invalidateRuntimeCache('interacoes:')
    invalidateRuntimeCache('crm-bootstrap:')

    return NextResponse.json(usuario, { status: 201 })
  } catch (error: any) {
    console.error('Erro ao criar usuario:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Email ja cadastrado' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao criar usuario' }, { status: 500 })
  }
}
