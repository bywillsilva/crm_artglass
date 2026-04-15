import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db/mysql'
import { getServerSession } from '@/lib/auth/session'
import {
  ensureCrmRuntimeSchema,
  syncDueFollowUpStatuses,
} from '@/lib/server/proposal-workflow'

type AuthenticatedUser = {
  id: string
  role: string
  ativo: boolean
}

export async function GET() {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    await ensureCrmRuntimeSchema()
    await syncDueFollowUpStatuses()

    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    connection = await getConnection()

    const execute = async <T>(sql: string, params: any[] = []) => {
      const [results] = await connection!.execute(sql, params)
      return results as T
    }

    const [user] = await execute<any[]>(
      'SELECT id, role, ativo FROM usuarios WHERE id = ? LIMIT 1',
      [session.userId]
    )

    if (!user || !user.ativo) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const authenticatedUser = user as AuthenticatedUser
    const isAdmin = authenticatedUser.role === 'admin' || authenticatedUser.role === 'gerente'

    const clientes = await execute<any[]>(
      `SELECT c.*
       FROM clientes c
       ORDER BY c.created_at DESC`
    )

    const usuarios = await execute<any[]>(
      `SELECT id, nome, email, avatar, role, ativo, meta_vendas, module_permissions, created_at
       FROM usuarios
       ORDER BY nome ASC`
    )

    const tarefas = await execute<any[]>(
      `SELECT t.*, c.nome as cliente_nome, u.nome as responsavel_nome
       FROM tarefas t
       LEFT JOIN clientes c ON t.cliente_id = c.id
       LEFT JOIN usuarios u ON t.responsavel_id = u.id
       WHERE ${isAdmin ? '1=1' : 't.responsavel_id = ?'}
       ORDER BY t.data_hora ASC`,
      isAdmin ? [] : [authenticatedUser.id]
    )

    const propostas = await execute<any[]>(
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
           ? 'p.responsavel_id = ?'
           : authenticatedUser.role === 'orcamentista'
             ? `p.status IN ('novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao')
                AND (p.orcamentista_id = ? OR p.orcamentista_id IS NULL OR p.orcamentista_id = '')`
             : '1=1'
       }
       ORDER BY p.created_at DESC`,
      authenticatedUser.role === 'vendedor' || authenticatedUser.role === 'orcamentista'
        ? [authenticatedUser.id]
        : []
    )

    return NextResponse.json({
      clientes,
      usuarios,
      tarefas,
      propostas,
    })
  } catch (error) {
    console.error('Erro ao carregar bootstrap do CRM:', error)
    return NextResponse.json({ error: 'Erro ao carregar bootstrap do CRM' }, { status: 500 })
  } finally {
    if (connection) {
      connection.release()
    }
  }
}
