import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError, query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
import { getRuntimeCache, setRuntimeCache } from '@/lib/server/runtime-cache'

const USUARIOS_CACHE_TTL_MS = Math.max(Number(process.env.USUARIOS_CACHE_TTL_MS || 30_000), 1000)

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
  const cacheKey = `usuarios:list:${role || 'todos'}:${ativo || 'todos'}`

  try {
    await ensureUserManagementSchema()

    const cachedUsuarios = getRuntimeCache<any[]>(cacheKey)
    if (cachedUsuarios !== undefined) {
      return NextResponse.json(cachedUsuarios)
    }

    let sql =
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE 1=1'
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
    return NextResponse.json(usuarios)
  } catch (error: any) {
    console.error('Erro ao buscar usuarios:', error)

    if (isTransientDatabaseError(error)) {
      return NextResponse.json(getRuntimeCache<any[]>(cacheKey) || [], { status: 200 })
    }

    return NextResponse.json({ error: 'Erro ao buscar usuarios' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureUserManagementSchema()

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

    const iniciais = data.nome
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

    await query(
      `INSERT INTO usuarios (id, nome, email, senha, avatar, role, ativo, meta_vendas, module_permissions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    )

    const [usuario] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE id = ?',
      [id]
    )

    await publishRealtimeEvent({
      actorUserId: null,
      resource: 'usuario',
      resourceId: id,
    })

    return NextResponse.json(usuario, { status: 201 })
  } catch (error: any) {
    console.error('Erro ao criar usuario:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Email ja cadastrado' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao criar usuario' }, { status: 500 })
  }
}
