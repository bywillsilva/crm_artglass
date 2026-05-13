import { NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'

function ensureDevelopmentMode() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Not found')
  }
}

export async function GET() {
  try {
    ensureDevelopmentMode()

    const sellers = await query<any[]>(
      `SELECT id, nome, email, role
       FROM usuarios
       WHERE role = 'vendedor' AND ativo = TRUE
       ORDER BY nome ASC`
    )

    const proposals = await query<any[]>(
      `SELECT
         p.id,
         p.numero,
         p.status,
         p.responsavel_id AS responsavelId,
         c.id AS clienteId,
         c.nome AS clienteNome,
         c.tipo AS clienteTipo,
         c.empresa AS clienteEmpresa,
         c.cpf AS clienteDocumento
       FROM propostas p
       INNER JOIN clientes c ON c.id = p.cliente_id
       WHERE p.status IN ('enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by')
         AND (c.tipo = 'comercial' OR (c.empresa IS NOT NULL AND c.empresa <> ''))
       ORDER BY p.updated_at DESC
       LIMIT 20`
    )

    return NextResponse.json({ sellers, proposals })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    console.error('Erro ao carregar contexto temporario de teste:', error)
    return NextResponse.json({ error: 'Erro ao carregar contexto de teste' }, { status: 500 })
  }
}
