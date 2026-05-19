import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { normalizeRulePermissions } from '@/lib/auth/rule-access'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { ensureSystemDatabaseSchema } from '@/lib/server/database-schema'
import { getRuntimeCache, invalidateRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'
import { clearAuthenticatedUserCache, getAuthenticatedServerUser } from '@/lib/auth/session'
import { jsonNoStore } from '@/lib/server/http-cache'
import { syncNormalizedUserPermissionsWithPrisma } from '@/lib/server/user-permissions-store'
import { attachAvatarColors, setUserAvatarColor } from '@/lib/server/user-avatar-color'

const USUARIOS_CACHE_TTL_MS = Math.max(Number(process.env.USUARIOS_CACHE_TTL_MS || 30_000), 1000)

const USER_SELECT = {
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
} as const

function isTransientUserDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

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

    const where: any = {}

    if (role && role !== 'todos') {
      where.role = role
    }

    if (ativo !== null && ativo !== 'todos') {
      where.ativo = ativo === 'true'
    }

    const usuarios = await prisma.usuarios.findMany({
      where,
      select: USER_SELECT,
      orderBy: { nome: 'asc' },
    })
    const usuariosWithColors = await attachAvatarColors(usuarios)
    setRuntimeCache(cacheKey, usuariosWithColors, USUARIOS_CACHE_TTL_MS)
    return jsonNoStore(usuariosWithColors)
  } catch (error: any) {
    console.error('Erro ao buscar usuarios:', error)

    if (isTransientUserDatabaseError(error)) {
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

    const iniciaisInformadas = String(data.avatar || '').trim().toUpperCase().slice(0, 2)
    const iniciais = iniciaisInformadas || String(data.nome || '')
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    const role = data.role || 'vendedor'
    const usuario = await prisma.$transaction(async (tx) => {
      await tx.usuarios.create({
        data: {
          id,
          nome: data.nome,
          email: data.email,
          senha: senhaHash,
          avatar: iniciais,
          role,
          ativo: data.ativo ?? true,
          meta_vendas: parseNullableNumber(data.metaVendas ?? data.meta_vendas, 0),
          module_permissions: JSON.stringify(modulePermissions),
          rule_permissions: JSON.stringify(rulePermissions),
        } as any,
      })

      await setUserAvatarColor(id, data.avatarColor ?? data.avatar_color, tx)

      await syncNormalizedUserPermissionsWithPrisma(
        {
          userId: id,
          role,
          modulePermissions,
          rulePermissions,
        },
        tx
      )

      const saved = await tx.usuarios.findUnique({
        where: { id },
        select: USER_SELECT,
      })
      return saved ? (await attachAvatarColors([saved], tx))[0] : saved
    })

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
    clearAuthenticatedUserCache(id)

    return NextResponse.json(usuario, { status: 201 })
  } catch (error: any) {
    console.error('Erro ao criar usuario:', error)
    if (error.code === 'ER_DUP_ENTRY' || error.code === 'P2002') {
      return NextResponse.json({ error: 'Email ja cadastrado' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao criar usuario' }, { status: 500 })
  }
}
