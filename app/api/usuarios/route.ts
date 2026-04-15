import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { ensureUserManagementSchema } from '@/lib/server/proposal-workflow'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import { normalizeModulePermissions } from '@/lib/auth/module-access'

export async function GET(request: NextRequest) {
  try {
    await ensureUserManagementSchema()
    const searchParams = request.nextUrl.searchParams
    const role = searchParams.get('role')
    const ativo = searchParams.get('ativo')

    let sql = 'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE 1=1'
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
    return NextResponse.json(usuarios)
  } catch (error) {
    console.error('Erro ao buscar usuários:', error)
    return NextResponse.json({ error: 'Erro ao buscar usuários' }, { status: 500 })
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

    // Gerar avatar a partir das iniciais
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
        Number(data.metaVendas ?? data.meta_vendas ?? 0),
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
    console.error('Erro ao criar usuário:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Email já cadastrado' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erro ao criar usuário' }, { status: 500 })
  }
}
