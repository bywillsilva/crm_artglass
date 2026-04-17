import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const USUARIO_DETAIL_CACHE_TTL_MS = Math.max(
  Number(process.env.USUARIO_DETAIL_CACHE_TTL_MS || 30_000),
  1000
)

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    await ensureUserManagementSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    if (!canAccessUsuariosModule(user)) {
      return NextResponse.json({ error: 'Acesso negado ao modulo de usuarios' }, { status: 403 })
    }

    const cacheKey = `usuario:detail:${user.id}:${user.role}:${id}`

    const cachedUsuario = getRuntimeCache<any>(cacheKey)
    if (cachedUsuario !== undefined) {
      return NextResponse.json(cachedUsuario)
    }

    const [usuario] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE id = ?',
      [id]
    )

    if (!usuario) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    setRuntimeCache(cacheKey, usuario, USUARIO_DETAIL_CACHE_TTL_MS)
    return NextResponse.json(usuario)
  } catch (error) {
    console.error('Erro ao buscar usuario:', error)

    if (isTransientDatabaseError(error)) {
      const user = await getAuthenticatedServerUser().catch(() => null)
      if (!user) {
        return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
      }
      const cacheKey = `usuario:detail:${user.id}:${user.role}:${id}`
      const cachedUsuario = getRuntimeCache<any>(cacheKey)
      if (cachedUsuario) {
        return NextResponse.json(cachedUsuario, { status: 200 })
      }
    }

    return NextResponse.json({ error: 'Erro ao buscar usuario' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureUserManagementSchema()

    const authenticatedUser = await getAuthenticatedServerUser()
    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    if (!canAccessUsuariosModule(authenticatedUser)) {
      return NextResponse.json({ error: 'Acesso negado ao modulo de usuarios' }, { status: 403 })
    }

    const { id } = await params
    const data = await request.json()
    const session = await getServerSession()

    const [usuarioAtual] = await query<any[]>(
      'SELECT id, role, module_permissions FROM usuarios WHERE id = ? LIMIT 1',
      [id]
    )

    if (!usuarioAtual) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    if (
      session &&
      session.userId === id &&
      usuarioAtual.role === 'admin' &&
      ((data.role && data.role !== 'admin') || data.ativo === false)
    ) {
      return NextResponse.json(
        { error: 'O administrador nao pode reduzir o proprio acesso nem desativar a propria conta' },
        { status: 400 }
      )
    }

    const iniciais = String(data.nome || '')
      .split(' ')
      .filter(Boolean)
      .map((parte: string) => parte[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    const nextRole = data.role || usuarioAtual.role
    const modulePermissions = normalizeModulePermissions(
      data.modulePermissions ?? usuarioAtual.module_permissions,
      nextRole
    )

    let sql = 'UPDATE usuarios SET nome = ?, email = ?, avatar = ?, role = ?, ativo = ?, meta_vendas = ?'
    const queryParams: unknown[] = [
      data.nome,
      data.email,
      iniciais,
      nextRole,
      data.ativo,
      parseNullableNumber(data.metaVendas ?? data.meta_vendas, 0),
    ]

    sql += ', module_permissions = ?'
    queryParams.push(JSON.stringify(modulePermissions))

    if (data.senha) {
      const senhaHash = await bcrypt.hash(data.senha, 10)
      sql += ', senha = ?'
      queryParams.push(senhaHash)
    }

    sql += ' WHERE id = ?'
    queryParams.push(id)

    await query(sql, queryParams)

    const [usuario] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE id = ?',
      [id]
    )

    await publishRealtimeEvent({
      actorUserId: session?.userId || null,
      resource: 'usuario',
      resourceId: id,
    })

    return NextResponse.json(usuario)
  } catch (error: any) {
    console.error('Erro ao atualizar usuario:', error)

    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Email ja cadastrado' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Erro ao atualizar usuario' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await getAuthenticatedServerUser()
    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }
    if (!canAccessUsuariosModule(authenticatedUser)) {
      return NextResponse.json({ error: 'Acesso negado ao modulo de usuarios' }, { status: 403 })
    }

    const { id } = await params
    const session = await getServerSession()

    if (session?.userId === id) {
      return NextResponse.json(
        { error: 'Nao e permitido excluir o proprio usuario logado' },
        { status: 400 }
      )
    }

    const [usuario] = await query<any[]>(
      'SELECT id, role FROM usuarios WHERE id = ? LIMIT 1',
      [id]
    )

    if (!usuario) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    if (usuario.role === 'admin') {
      return NextResponse.json(
        { error: 'Nao e permitido excluir o usuario administrador' },
        { status: 403 }
      )
    }

    const [propostasCount] = await query<any[]>(
      'SELECT COUNT(*) as total FROM propostas WHERE responsavel_id = ?',
      [id]
    )

    if (propostasCount.total > 0) {
      return NextResponse.json(
        { error: 'Nao e possivel excluir usuario com propostas associadas' },
        { status: 400 }
      )
    }

    const [tarefasCount] = await query<any[]>(
      'SELECT COUNT(*) as total FROM tarefas WHERE responsavel_id = ? AND status <> ?',
      [id, 'concluida']
    )

    if (tarefasCount.total > 0) {
      return NextResponse.json(
        { error: 'Nao e possivel excluir usuario com tarefas pendentes associadas' },
        { status: 400 }
      )
    }

    await query('DELETE FROM usuarios WHERE id = ?', [id])

    await publishRealtimeEvent({
      actorUserId: session?.userId || null,
      resource: 'usuario',
      resourceId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar usuario:', error)
    return NextResponse.json({ error: 'Erro ao deletar usuario' }, { status: 500 })
  }
}
