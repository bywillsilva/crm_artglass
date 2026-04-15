import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db/mysql'
import { v4 as uuidv4 } from 'uuid'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'

const USER_KEYS = ['geral', 'notificacoes', 'aparencia']
const GLOBAL_KEYS = ['empresa', 'funil']
const CONFIG_SCHEMA_CACHE_MS = 60 * 60 * 1000

let configuracoesSchemaCheckedAt = 0
let configuracoesSchemaPromise: Promise<void> | null = null

async function ensureConfiguracoesSchema() {
  const now = Date.now()
  if (now - configuracoesSchemaCheckedAt < CONFIG_SCHEMA_CACHE_MS) {
    return
  }

  if (configuracoesSchemaPromise) {
    await configuracoesSchemaPromise
    return
  }

  configuracoesSchemaPromise = (async () => {
    const columns = await query<any[]>(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'configuracoes'
    `)

    const columnNames = new Set(columns.map((column) => column.COLUMN_NAME))

    if (!columnNames.has('scope')) {
      await query(`ALTER TABLE configuracoes ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'global' AFTER chave`)
    }

    if (!columnNames.has('user_id')) {
      await query(`ALTER TABLE configuracoes ADD COLUMN user_id VARCHAR(36) NOT NULL DEFAULT '' AFTER scope`)
    }

    await query(`UPDATE configuracoes SET scope = 'global' WHERE scope IS NULL OR scope = ''`)
    await query(`UPDATE configuracoes SET user_id = '' WHERE user_id IS NULL`)

    const indexes = await query<any[]>('SHOW INDEX FROM configuracoes')
    const hasScopedUnique = indexes.some((index) => index.Key_name === 'unique_config_scope')
    const oldUniqueIndexes = indexes.filter(
      (index) => index.Non_unique === 0 && index.Key_name !== 'PRIMARY' && index.Key_name !== 'unique_config_scope'
    )

    for (const index of oldUniqueIndexes) {
      await query(`ALTER TABLE configuracoes DROP INDEX ${index.Key_name}`)
    }

    if (!hasScopedUnique) {
      await query(`ALTER TABLE configuracoes ADD UNIQUE KEY unique_config_scope (chave, scope, user_id)`)
    }

    configuracoesSchemaCheckedAt = Date.now()
  })()

  try {
    await configuracoesSchemaPromise
  } finally {
    configuracoesSchemaPromise = null
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureConfiguracoesSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const chave = searchParams.get('chave')

    if (chave) {
      if (GLOBAL_KEYS.includes(chave)) {
        const [config] = await query<any[]>(
          `SELECT * FROM configuracoes WHERE chave = ? AND scope = 'global' AND user_id = '' LIMIT 1`,
          [chave]
        )
        return NextResponse.json(config || null)
      }

      const [config] = await query<any[]>(
        `SELECT *
         FROM configuracoes
         WHERE chave = ?
           AND (
             (scope = 'user' AND user_id = ?)
             OR (scope = 'global' AND user_id = '')
           )
         ORDER BY CASE WHEN scope = 'user' THEN 0 ELSE 1 END
         LIMIT 1`,
        [chave, user.id]
      )
      return NextResponse.json(config || null)
    }

    const configs = await query<any[]>(
      `SELECT *
       FROM configuracoes
       WHERE (chave = 'empresa' AND scope = 'global' AND user_id = '')
          OR (chave IN ('geral', 'notificacoes', 'aparencia') AND (
               (scope = 'user' AND user_id = ?)
               OR (scope = 'global' AND user_id = '')
             ))
       ORDER BY chave, CASE WHEN scope = 'user' THEN 0 ELSE 1 END`,
      [user.id]
    )

    const byKey = new Map<string, any>()
    configs.forEach((config) => {
      if (!byKey.has(config.chave)) {
        byKey.set(config.chave, config)
      }
    })

    return NextResponse.json(Array.from(byKey.values()))
  } catch (error) {
    console.error('Erro ao buscar configuracoes:', error)
    return NextResponse.json({ error: 'Erro ao buscar configuracoes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureConfiguracoesSchema()

    const user = await getAuthenticatedServerUser()
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const data = await request.json()
    const isCompanyConfig = data.chave === 'empresa'

    if (isCompanyConfig && user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Apenas o administrador pode alterar os dados da empresa' },
        { status: 403 }
      )
    }

    const scope = isCompanyConfig ? 'global' : 'user'
    const userId = isCompanyConfig ? '' : user.id

    const [existing] = await query<any[]>(
      'SELECT * FROM configuracoes WHERE chave = ? AND scope = ? AND user_id = ? LIMIT 1',
      [data.chave, scope, userId]
    )

    if (existing) {
      await query(
        'UPDATE configuracoes SET valor = ? WHERE chave = ? AND scope = ? AND user_id = ?',
        [JSON.stringify(data.valor), data.chave, scope, userId]
      )
    } else {
      await query(
        'INSERT INTO configuracoes (id, chave, scope, user_id, valor) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), data.chave, scope, userId, JSON.stringify(data.valor)]
      )
    }

    const [config] = await query<any[]>(
      'SELECT * FROM configuracoes WHERE chave = ? AND scope = ? AND user_id = ? LIMIT 1',
      [data.chave, scope, userId]
    )

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: data.chave === 'empresa' ? 'config_global' : 'config_usuario',
      resourceId: data.chave,
    })

    return NextResponse.json(config)
  } catch (error) {
    console.error('Erro ao salvar configuracao:', error)
    return NextResponse.json({ error: 'Erro ao salvar configuracao' }, { status: 500 })
  }
}
