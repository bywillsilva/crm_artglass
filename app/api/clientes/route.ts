import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getServerSession } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/server/proposal-workflow'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    let sql = `
      SELECT c.*
      FROM clientes c
      WHERE 1=1
    `
    const params: unknown[] = []

    if (status && status !== 'todos') {
      sql += ' AND c.status_funil = ?'
      params.push(status)
    }

    if (search) {
      sql += ' AND (c.nome LIKE ? OR c.email LIKE ? OR c.empresa LIKE ?)'
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    sql += ' ORDER BY c.created_at DESC'

    const clientes = await query(sql, params)
    return NextResponse.json(clientes)
  } catch (error) {
    console.error('Erro ao buscar clientes:', error)
    return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const id = uuidv4()

    await query(
      `INSERT INTO clientes (
        id, nome, email, telefone, empresa, cargo, endereco, cidade, estado, cep,
        origem, status_funil, valor_potencial, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.nome,
        data.email || null,
        data.telefone || null,
        data.empresa || null,
        data.cargo || null,
        data.endereco || null,
        data.cidade || null,
        data.estado || null,
        data.cep || null,
        data.origem || 'site',
        data.statusFunil || 'lead_novo',
        data.valorPotencial || 0,
        data.observacoes || null,
      ]
    )

    // Criar interação de registro
    await query(
      `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, created_at) 
       VALUES (?, ?, ?, 'nota', 'Cliente cadastrado no sistema', ?)`,
      [uuidv4(), id, session.userId, formatDateTime(new Date())]
    )

    const [cliente] = await query<any[]>('SELECT * FROM clientes WHERE id = ?', [id])
    return NextResponse.json(cliente, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar cliente:', error)
    return NextResponse.json({ error: 'Erro ao criar cliente' }, { status: 500 })
  }
}
