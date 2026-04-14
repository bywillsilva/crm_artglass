import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getServerSession } from '@/lib/auth/session'
import { ensureClientSchema, formatDateTime } from '@/lib/server/proposal-workflow'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureClientSchema()
    const { id } = await params
    const [cliente] = await query<any[]>(
      `SELECT c.*
       FROM clientes c
       WHERE c.id = ?`,
      [id]
    )

    if (!cliente) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    return NextResponse.json(cliente)
  } catch (error) {
    console.error('Erro ao buscar cliente:', error)
    return NextResponse.json({ error: 'Erro ao buscar cliente' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureClientSchema()
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { id } = await params
    const data = await request.json()

    // Buscar status atual para verificar mudança
    const [clienteAtual] = await query<any[]>(
      'SELECT status_funil, observacoes FROM clientes WHERE id = ?',
      [id]
    )

    await query(
      `UPDATE clientes SET
        nome = ?, email = ?, telefone = ?, empresa = ?, cargo = ?,
        endereco = ?, cidade = ?, estado = ?, cep = ?, origem = ?,
        status_funil = ?, valor_potencial = ?, observacoes = ?
      WHERE id = ?`,
      [
        data.nome,
        data.email || null,
        data.telefone || null,
        data.empresa || null,
        data.cargo || null,
        data.endereco || null,
        data.cidade || null,
        data.estado || null,
        data.cep || null,
        data.origem || null,
        data.statusFunil || 'lead_novo',
        data.valorPotencial || 0,
        data.observacoes || null,
        id,
      ]
    )

    // Registrar mudança de status se houver
    if (clienteAtual && clienteAtual.status_funil !== data.statusFunil) {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'mudanca_status', ?, ?, ?)`,
        [
          uuidv4(),
          id,
          session.userId,
          `Status alterado de ${clienteAtual.status_funil} para ${data.statusFunil}`,
          JSON.stringify({ de: clienteAtual.status_funil, para: data.statusFunil }),
          formatDateTime(new Date()),
        ]
      )
    }

    if ((clienteAtual?.observacoes || '') !== (data.observacoes || '')) {
      await query(
        `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
         VALUES (?, ?, ?, 'nota', ?, ?, ?)`,
        [
          uuidv4(),
          id,
          session.userId,
          'Observacoes do cliente atualizadas',
          JSON.stringify({ campo: 'observacoes', origem: 'cliente' }),
          formatDateTime(new Date()),
        ]
      )
    }

    const [cliente] = await query<any[]>('SELECT * FROM clientes WHERE id = ?', [id])
    return NextResponse.json(cliente)
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error)
    return NextResponse.json({ error: 'Erro ao atualizar cliente' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await query('DELETE FROM clientes WHERE id = ?', [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Erro ao deletar cliente:', error)
    return NextResponse.json({ error: 'Erro ao deletar cliente' }, { status: 500 })
  }
}
