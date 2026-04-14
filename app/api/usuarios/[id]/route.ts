import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import { ensureUserRoleSchema } from '@/lib/server/proposal-workflow'
import { normalizeModulePermissions } from '@/lib/auth/module-access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureUserRoleSchema()
    await query(`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS meta_vendas DECIMAL(15, 2) NOT NULL DEFAULT 0
    `)

    const { id } = await params
    const [usuario] = await query<any[]>(
      'SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at FROM usuarios WHERE id = ?',
      [id]
    )

    if (!usuario) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    return NextResponse.json(usuario)
  } catch (error) {
    console.error('Erro ao buscar usuario:', error)
    return NextResponse.json({ error: 'Erro ao buscar usuario' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureUserRoleSchema()
    await query(`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS meta_vendas DECIMAL(15, 2) NOT NULL DEFAULT 0
    `)

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
      data.role &&
      data.role !== 'admin'
    ) {
      return NextResponse.json(
        { error: 'O administrador nao pode alterar o proprio nivel de acesso' },
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
      Number(data.metaVendas ?? data.meta_vendas ?? 0),
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
    const { id } = await params

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
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar usuario:', error)
    return NextResponse.json({ error: 'Erro ao deletar usuario' }, { status: 500 })
  }
}
