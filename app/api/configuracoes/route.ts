import { NextRequest, NextResponse } from 'next/server'
import { isTransientDatabaseError, logDatabaseError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { v4 as uuidv4 } from 'uuid'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { getAuthenticatedServerUser } from '@/lib/auth/session'
import { publishRealtimeEvent } from '@/lib/server/realtime-events'
import {
  deleteRuntimeCache,
  getRuntimeCache,
  invalidateRuntimeCache,
  setRuntimeCache,
} from '@/lib/server/runtime-cache'

const USER_KEYS = ['geral', 'notificacoes', 'aparencia']
const GLOBAL_KEYS = ['empresa', 'funil']
const CONFIG_SCHEMA_CACHE_MS = 60 * 60 * 1000
const CONFIG_CACHE_TTL_MS = Math.max(Number(process.env.CONFIG_CACHE_TTL_MS || 30_000), 1000)

const CONFIG_SELECT = {
  id: true,
  chave: true,
  scope: true,
  user_id: true,
  valor: true,
} as const

let configuracoesSchemaCheckedAt = 0
let configuracoesSchemaPromise: Promise<void> | null = null

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

function isTransientConfigurationDatabaseError(error: unknown) {
  const prismaCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return isTransientDatabaseError(error) || ['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaCode)
}

function preferUserScopedConfig<T extends { scope: string }>(configs: T[]) {
  return [...configs].sort((a, b) => {
    const priorityA = a.scope === 'user' ? 0 : 1
    const priorityB = b.scope === 'user' ? 0 : 1
    return priorityA - priorityB
  })[0] || null
}

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
    const searchParams = request.nextUrl.searchParams
    const chave = searchParams.get('chave')
    const isPublicGlobalCompanyRequest = chave === 'empresa'
    const user = await getAuthenticatedServerUser()

    if (!user && !isPublicGlobalCompanyRequest) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    if (chave) {
      const scopedCacheKey = `config:${chave}:${GLOBAL_KEYS.includes(chave) ? 'global' : (user?.id || 'anon')}`
      const cachedConfig = getRuntimeCache<any>(scopedCacheKey)
      if (cachedConfig !== undefined) {
        return NextResponse.json(cachedConfig, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        })
      }

      if (GLOBAL_KEYS.includes(chave)) {
        const config = await prisma.configuracoes.findFirst({
          where: {
            chave,
            scope: 'global',
            user_id: '',
          },
          select: CONFIG_SELECT,
        })
        setRuntimeCache(scopedCacheKey, config, CONFIG_CACHE_TTL_MS)
        return NextResponse.json(config, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        })
      }

      if (!user) {
        return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
      }

      const configs = await prisma.configuracoes.findMany({
        where: {
          chave,
          OR: [
            { scope: 'user', user_id: user.id },
            { scope: 'global', user_id: '' },
          ],
        },
        select: CONFIG_SELECT,
      })
      const config = preferUserScopedConfig(configs)
      setRuntimeCache(scopedCacheKey, config, CONFIG_CACHE_TTL_MS)
      return NextResponse.json(config, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      })
    }

    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const listCacheKey = `config:list:${user.id}`
    const cachedConfigs = getRuntimeCache<any[]>(listCacheKey)
    if (cachedConfigs !== undefined) {
      return NextResponse.json(cachedConfigs, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      })
    }

    const configs = await prisma.configuracoes.findMany({
      where: {
        OR: [
          { chave: 'empresa', scope: 'global', user_id: '' },
          {
            chave: { in: USER_KEYS },
            OR: [
              { scope: 'user', user_id: user.id },
              { scope: 'global', user_id: '' },
            ],
          },
        ],
      },
      select: CONFIG_SELECT,
      orderBy: { chave: 'asc' },
    })

    const byKey = new Map<string, any>()
    const orderedConfigs = [...configs].sort((a, b) => {
      const keyOrder = a.chave.localeCompare(b.chave)
      if (keyOrder !== 0) {
        return keyOrder
      }
      const priorityA = a.scope === 'user' ? 0 : 1
      const priorityB = b.scope === 'user' ? 0 : 1
      return priorityA - priorityB
    })
    orderedConfigs.forEach((config) => {
      if (!byKey.has(config.chave)) {
        byKey.set(config.chave, config)
      }
    })

    const payload = Array.from(byKey.values())
    setRuntimeCache(listCacheKey, payload, CONFIG_CACHE_TTL_MS)
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (error) {
    if (!isTransientConfigurationDatabaseError(error)) {
      logDatabaseError('Erro ao buscar configuracoes', error)
    }
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
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

    if (isCompanyConfig && !hasRuleAccess(user, 'canEditCompanySettings')) {
      return NextResponse.json(
        { error: 'Apenas o administrador pode alterar os dados da empresa' },
        { status: 403 }
      )
    }

    const scope = isCompanyConfig ? 'global' : 'user'
    const userId = isCompanyConfig ? '' : user.id
    const serializedValue = JSON.stringify(data.valor)

    const existing = await prisma.configuracoes.findFirst({
      where: {
        chave: data.chave,
        scope,
        user_id: userId,
      },
      select: { id: true },
    })

    if (existing) {
      await prisma.configuracoes.update({
        where: { id: existing.id },
        data: { valor: serializedValue },
      })
    } else {
      await prisma.configuracoes.create({
        data: {
          id: uuidv4(),
          chave: data.chave,
          scope,
          user_id: userId,
          valor: serializedValue,
        },
      })
    }

    const config = await prisma.configuracoes.findFirst({
      where: {
        chave: data.chave,
        scope,
        user_id: userId,
      },
      select: CONFIG_SELECT,
    })

    deleteRuntimeCache(`config:list:${user.id}`)
    deleteRuntimeCache(`config:${data.chave}:${scope === 'global' ? 'global' : user.id}`)
    if (scope === 'global') {
      invalidateRuntimeCache('config:list:')
      invalidateRuntimeCache(`config:${data.chave}:`)
    }

    await publishRealtimeEvent({
      actorUserId: user.id,
      resource: data.chave === 'empresa' ? 'config_global' : 'config_usuario',
      resourceId: data.chave,
    })

    return NextResponse.json(config)
  } catch (error) {
    logDatabaseError('Erro ao salvar configuracao', error)
    if (isTransientConfigurationDatabaseError(error)) {
      return NextResponse.json({ error: 'Banco temporariamente indisponivel. Tente novamente em instantes.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Erro ao salvar configuracao' }, { status: 500 })
  }
}
