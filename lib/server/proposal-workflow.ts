import { v4 as uuidv4 } from 'uuid'
import { getConnection, query } from '@/lib/db/mysql'

export type ProposalWorkflowStatus =
  | 'novo_cliente'
  | 'em_orcamento'
  | 'aguardando_aprovacao'
  | 'enviar_ao_cliente'
  | 'enviado_ao_cliente'
  | 'follow_up_1_dia'
  | 'aguardando_follow_up_3_dias'
  | 'follow_up_3_dias'
  | 'aguardando_follow_up_7_dias'
  | 'follow_up_7_dias'
  | 'stand_by'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'

const LEGACY_STATUSES = [
  'rascunho',
  'enviada',
  'em_analise',
  'aprovada',
  'rejeitada',
  'expirada',
  'em_cotacao',
  'em_negociacao',
]

const FINAL_STATUSES: ProposalWorkflowStatus[] = [
  'novo_cliente',
  'em_orcamento',
  'aguardando_aprovacao',
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'aguardando_follow_up_3_dias',
  'follow_up_3_dias',
  'aguardando_follow_up_7_dias',
  'follow_up_7_dias',
  'stand_by',
  'em_retificacao',
  'fechado',
  'perdido',
]

const FOLLOW_UP_SYNC_STEPS = [
  { from: 'enviado_ao_cliente', to: 'follow_up_1_dia', stage: 'follow_up_1_dia' },
  { from: 'aguardando_follow_up_3_dias', to: 'follow_up_3_dias', stage: 'follow_up_3_dias' },
  { from: 'aguardando_follow_up_7_dias', to: 'follow_up_7_dias', stage: 'follow_up_7_dias' },
] as const

const MYSQL_TIMEZONE = process.env.MYSQL_TIMEZONE || '-03:00'
const cacheTimes = new Map<string, number>()
const cachePromises = new Map<string, Promise<void>>()
const SCHEMA_CACHE_MS = 5 * 60 * 1000
const RUNTIME_BOOTSTRAP_CACHE_MS = 60 * 60 * 1000
const RUNTIME_CACHE_MS = 60 * 1000

function parseTimeZoneOffsetInMinutes(timeZone: string) {
  const normalized = String(timeZone || '').trim()

  if (!normalized || normalized.toUpperCase() === 'UTC' || normalized === 'Z') {
    return 0
  }

  const match = normalized.match(/^([+-])(\d{2}):?(\d{2})$/)
  if (!match) {
    return -180
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3])

  return sign * (hours * 60 + minutes)
}

const MYSQL_OFFSET_MINUTES = parseTimeZoneOffsetInMinutes(MYSQL_TIMEZONE)

function toDatabaseTimeZoneDate(date: Date) {
  return new Date(date.getTime() + MYSQL_OFFSET_MINUTES * 60 * 1000)
}

type TableIndexDefinition = {
  name: string
  columns: string
}

async function runCached(name: string, ttlMs: number, task: () => Promise<void>) {
  const now = Date.now()
  const lastRunAt = cacheTimes.get(name) || 0
  if (now - lastRunAt < ttlMs) {
    return
  }

  const existing = cachePromises.get(name)
  if (existing) {
    await existing
    return
  }

  const promise = task()
  cachePromises.set(name, promise)

  try {
    await promise
    cacheTimes.set(name, Date.now())
  } finally {
    cachePromises.delete(name)
  }
}

async function ensureTableIndexes(tableName: string, indexes: TableIndexDefinition[]) {
  const existingIndexes = await query<any[]>(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME <> 'PRIMARY'`,
    [tableName]
  )

  const existingNames = new Set(existingIndexes.map((index) => index.INDEX_NAME))

  for (const index of indexes) {
    if (existingNames.has(index.name)) {
      continue
    }

    await query(`CREATE INDEX ${index.name} ON ${tableName} (${index.columns})`)
  }
}

function enumValues(values: readonly string[]) {
  return values.map((value) => `'${value}'`).join(', ')
}

export function normalizeProposalStatus(status?: string | null): ProposalWorkflowStatus {
  switch (status) {
    case 'novo_cliente':
    case 'em_orcamento':
    case 'aguardando_aprovacao':
    case 'enviar_ao_cliente':
    case 'enviado_ao_cliente':
    case 'follow_up_1_dia':
    case 'aguardando_follow_up_3_dias':
    case 'follow_up_3_dias':
    case 'aguardando_follow_up_7_dias':
    case 'follow_up_7_dias':
    case 'stand_by':
    case 'em_retificacao':
    case 'fechado':
    case 'perdido':
      return status
    case 'em_cotacao':
    case 'rascunho':
      return 'em_orcamento'
    case 'enviada':
      return 'enviado_ao_cliente'
    case 'em_analise':
    case 'em_negociacao':
      return 'follow_up_1_dia'
    case 'aprovada':
      return 'fechado'
    case 'rejeitada':
    case 'expirada':
      return 'perdido'
    default:
      return 'novo_cliente'
  }
}

export function formatDateTime(date: Date) {
  const zoned = toDatabaseTimeZoneDate(date)
  const year = zoned.getUTCFullYear()
  const month = String(zoned.getUTCMonth() + 1).padStart(2, '0')
  const day = String(zoned.getUTCDate()).padStart(2, '0')
  const hours = String(zoned.getUTCHours()).padStart(2, '0')
  const minutes = String(zoned.getUTCMinutes()).padStart(2, '0')
  const seconds = String(zoned.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function parseDatabaseDateTime(value?: string | Date | null) {
  if (!value) return null
  if (value instanceof Date) return value

  const normalized = String(value).trim()
  const localMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  )

  if (localMatch) {
    const [, year, month, day, hours = '0', minutes = '0', seconds = '0'] = localMatch
    const timestamp =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds)
      ) -
      MYSQL_OFFSET_MINUTES * 60 * 1000

    return new Date(timestamp)
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addHours(date: Date, hours: number) {
  const next = new Date(date)
  next.setHours(next.getHours() + hours)
  return next
}

function applyTimeToDate(baseDate: Date, timeValue?: string | null) {
  const next = new Date(baseDate)
  if (!timeValue) {
    return next
  }

  const [hours, minutes = '0', seconds = '0'] = timeValue.split(':')
  next.setHours(Number(hours) || 0, Number(minutes) || 0, Number(seconds) || 0, 0)
  return next
}

async function ensureProposalColumns() {
  const columns = await query<any[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'propostas'
       AND COLUMN_NAME IN ('orcamentista_id', 'retificacoes_count', 'follow_up_base_at', 'follow_up_time')`
  )

  const existing = new Set(columns.map((column) => column.COLUMN_NAME))

  if (!existing.has('orcamentista_id')) {
    await query(`ALTER TABLE propostas ADD COLUMN orcamentista_id VARCHAR(36) NULL AFTER responsavel_id`)
  }

  if (!existing.has('retificacoes_count')) {
    await query(`ALTER TABLE propostas ADD COLUMN retificacoes_count INT NOT NULL DEFAULT 0 AFTER orcamentista_id`)
  }

  if (!existing.has('follow_up_base_at')) {
    await query(`ALTER TABLE propostas ADD COLUMN follow_up_base_at DATETIME NULL AFTER retificacoes_count`)
  }

  if (!existing.has('follow_up_time')) {
    await query(`ALTER TABLE propostas ADD COLUMN follow_up_time TIME NULL AFTER follow_up_base_at`)
  }
}

async function ensureProposalSupportTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS proposta_anexos (
      id VARCHAR(36) PRIMARY KEY,
      proposta_id VARCHAR(36) NOT NULL,
      nome_original VARCHAR(255) NOT NULL,
      nome_arquivo VARCHAR(255) NOT NULL,
      caminho VARCHAR(500) NOT NULL,
      tipo_mime VARCHAR(150) NOT NULL,
      tamanho BIGINT NOT NULL DEFAULT 0,
      usuario_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS proposta_comentarios (
      id VARCHAR(36) PRIMARY KEY,
      proposta_id VARCHAR(36) NOT NULL,
      usuario_id VARCHAR(36) NOT NULL,
      comentario TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await ensureTableIndexes('proposta_anexos', [
    { name: 'idx_proposta_anexos_proposta', columns: 'proposta_id' },
    { name: 'idx_proposta_anexos_usuario', columns: 'usuario_id' },
  ])

  await ensureTableIndexes('proposta_comentarios', [
    { name: 'idx_proposta_comentarios_proposta_created', columns: 'proposta_id, created_at' },
    { name: 'idx_proposta_comentarios_usuario', columns: 'usuario_id' },
  ])
}

export async function ensureProposalSequenceSchema() {
  await runCached('ensureProposalSequenceSchema', SCHEMA_CACHE_MS, async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS proposal_sequences (
        ano INT PRIMARY KEY,
        ultimo_numero INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)
  })
}

export async function getNextProposalNumber(
  year = toDatabaseTimeZoneDate(new Date()).getUTCFullYear()
) {
  await ensureProposalSequenceSchema()
  const connection = await getConnection()

  try {
    const [maxRows] = await connection.execute(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)), 0) as maxNumero
       FROM propostas
       WHERE numero LIKE ?`,
      [`PROP-${year}-%`]
    )
    const currentMax = Number((maxRows as any[])[0]?.maxNumero || 0)

    await connection.execute(
      `INSERT INTO proposal_sequences (ano, ultimo_numero)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ultimo_numero = GREATEST(ultimo_numero, VALUES(ultimo_numero))`,
      [year, currentMax]
    )

    const [updateResult] = await connection.execute(
      `UPDATE proposal_sequences
       SET ultimo_numero = LAST_INSERT_ID(ultimo_numero + 1),
           updated_at = CURRENT_TIMESTAMP
       WHERE ano = ?`,
      [year]
    )

    const nextNumber = Number((updateResult as { insertId?: number }).insertId || 1)
    return `PROP-${year}-${String(nextNumber).padStart(3, '0')}`
  } finally {
    connection.release()
  }
}

export async function ensureProposalStatusSchema() {
  await runCached('ensureProposalStatusSchema', SCHEMA_CACHE_MS, async () => {
    const [column] = await query<any[]>(
      `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'propostas'
         AND COLUMN_NAME = 'status'`
    )

    const columnType = String(column?.COLUMN_TYPE || '')
    const hasLegacyStatuses = LEGACY_STATUSES.some((status) => columnType.includes(`'${status}'`))
    const hasFinalStatuses = FINAL_STATUSES.every((status) => columnType.includes(`'${status}'`))

    await ensureProposalColumns()
    await ensureProposalSupportTables()
    await ensureProposalSequenceSchema()
    await ensureTableIndexes('propostas', [
      { name: 'idx_propostas_status_created', columns: 'status, created_at' },
      { name: 'idx_propostas_responsavel_status', columns: 'responsavel_id, status' },
      { name: 'idx_propostas_orcamentista_status', columns: 'orcamentista_id, status' },
      { name: 'idx_propostas_cliente', columns: 'cliente_id' },
      { name: 'idx_propostas_follow_up_base', columns: 'follow_up_base_at' },
    ])
    await ensureTableIndexes('interacoes', [
      { name: 'idx_interacoes_cliente_created', columns: 'cliente_id, created_at' },
      { name: 'idx_interacoes_tipo_created', columns: 'tipo, created_at' },
      { name: 'idx_interacoes_usuario_created', columns: 'usuario_id, created_at' },
    ])

    if (!hasLegacyStatuses && hasFinalStatuses) {
      return
    }

    await query(`
      ALTER TABLE propostas
      MODIFY COLUMN status ENUM(
        ${enumValues([...LEGACY_STATUSES, ...FINAL_STATUSES])}
      ) DEFAULT 'novo_cliente'
    `)

    await query(`UPDATE propostas SET status = 'em_orcamento' WHERE status IN ('rascunho', 'em_cotacao')`)
    await query(`UPDATE propostas SET status = 'enviado_ao_cliente' WHERE status = 'enviada'`)
    await query(`UPDATE propostas SET status = 'follow_up_1_dia' WHERE status IN ('em_analise', 'em_negociacao')`)
    await query(`UPDATE propostas SET status = 'fechado' WHERE status = 'aprovada'`)
    await query(`UPDATE propostas SET status = 'perdido' WHERE status IN ('rejeitada', 'expirada')`)

    await query(`
      ALTER TABLE propostas
      MODIFY COLUMN status ENUM(
        ${enumValues(FINAL_STATUSES)}
      ) DEFAULT 'novo_cliente'
    `)
  })
}

export async function ensureTaskSchema() {
  await runCached('ensureTaskSchema', SCHEMA_CACHE_MS, async () => {
    const columns = await query<any[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'tarefas'
         AND COLUMN_NAME IN ('titulo', 'proposta_id', 'automacao_etapa', 'origem')`
    )

    const existing = new Set(columns.map((column) => column.COLUMN_NAME))

    if (!existing.has('titulo')) {
      await query(`ALTER TABLE tarefas ADD COLUMN titulo VARCHAR(255) NOT NULL DEFAULT 'Tarefa' AFTER id`)
      await query(`
        UPDATE tarefas
        SET titulo = LEFT(COALESCE(NULLIF(descricao, ''), 'Tarefa'), 255)
        WHERE titulo = 'Tarefa'
      `)
    }

    if (!existing.has('proposta_id')) {
      await query(`ALTER TABLE tarefas ADD COLUMN proposta_id VARCHAR(36) NULL`)
    }

    if (!existing.has('automacao_etapa')) {
      await query(`ALTER TABLE tarefas ADD COLUMN automacao_etapa VARCHAR(50) NULL`)
    }

    if (!existing.has('origem')) {
      await query(`ALTER TABLE tarefas ADD COLUMN origem VARCHAR(30) NOT NULL DEFAULT 'manual'`)
    }

    await ensureTableIndexes('tarefas', [
      { name: 'idx_tarefas_cliente_status_data', columns: 'cliente_id, status, data_hora' },
      { name: 'idx_tarefas_responsavel_status_data', columns: 'responsavel_id, status, data_hora' },
      { name: 'idx_tarefas_proposta_origem_status', columns: 'proposta_id, origem, status' },
      { name: 'idx_tarefas_automacao_etapa_data', columns: 'automacao_etapa, status, data_hora' },
    ])
  })
}

export async function ensureUserRoleSchema() {
  await runCached('ensureUserRoleSchema', SCHEMA_CACHE_MS, async () => {
    const [column] = await query<any[]>(
      `SELECT COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'usuarios'
         AND COLUMN_NAME = 'role'`
    )

    const columnType = String(column?.COLUMN_TYPE || '')
    const permissionColumns = await query<any[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'usuarios'
         AND COLUMN_NAME = 'module_permissions'`
    )

    if (columnType.includes(`'orcamentista'`)) {
      if (!permissionColumns.length) {
        await query(`ALTER TABLE usuarios ADD COLUMN module_permissions JSON NULL AFTER ativo`)
      }
      return
    }

    await query(`
      ALTER TABLE usuarios
      MODIFY COLUMN role ENUM('admin', 'gerente', 'vendedor', 'orcamentista') NOT NULL DEFAULT 'vendedor'
    `)

    if (!permissionColumns.length) {
      await query(`ALTER TABLE usuarios ADD COLUMN module_permissions JSON NULL AFTER ativo`)
    }
  })
}

export async function ensureUserManagementSchema() {
  await runCached('ensureUserManagementSchema', SCHEMA_CACHE_MS, async () => {
    await ensureUserRoleSchema()

    const metaVendasColumns = await query<any[]>(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'usuarios'
         AND COLUMN_NAME = 'meta_vendas'`
    )

    if (!metaVendasColumns.length) {
      await query(`
        ALTER TABLE usuarios
        ADD COLUMN meta_vendas DECIMAL(15, 2) NOT NULL DEFAULT 0
      `)
    }
  })
}

export async function ensureClientSchema() {
  await runCached('ensureClientSchema', SCHEMA_CACHE_MS, async () => {
    const columns = await query<any[]>(
      `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'clientes'
         AND COLUMN_NAME IN ('email', 'origem', 'cpf')`
    )

    const emailColumn = columns.find((column) => column.COLUMN_NAME === 'email')
    const origemColumn = columns.find((column) => column.COLUMN_NAME === 'origem')
    const cpfColumn = columns.find((column) => column.COLUMN_NAME === 'cpf')

    const emailNeedsUpdate = emailColumn && emailColumn.IS_NULLABLE !== 'YES'
    const origemNeedsUpdate =
      origemColumn &&
      (origemColumn.IS_NULLABLE !== 'YES' ||
        origemColumn.COLUMN_DEFAULT !== null ||
        !String(origemColumn.COLUMN_TYPE || '').includes(`'outro'`))
    const cpfNeedsCreate = !cpfColumn

    if (!emailNeedsUpdate && !origemNeedsUpdate && !cpfNeedsCreate) {
      return
    }

    if (cpfNeedsCreate) {
      await query(`
        ALTER TABLE clientes
        ADD COLUMN cpf VARCHAR(20) NULL AFTER nome
      `)
    }

    if (emailNeedsUpdate || origemNeedsUpdate) {
      await query(`
        ALTER TABLE clientes
        MODIFY COLUMN email VARCHAR(255) NULL,
        MODIFY COLUMN origem ENUM('site', 'indicacao', 'google', 'facebook', 'instagram', 'telefone', 'outro') NULL DEFAULT NULL
      `)
    }
  })
}

export async function ensureResponsibilityIntegrity() {
  await runCached('ensureResponsibilityIntegrity', SCHEMA_CACHE_MS, async () => {
    const [fallbackSeller] = await query<any[]>(
      `SELECT id
       FROM usuarios
       WHERE ativo = TRUE
         AND role IN ('admin', 'gerente', 'vendedor')
       ORDER BY CASE WHEN role = 'admin' THEN 0 WHEN role = 'gerente' THEN 1 ELSE 2 END, created_at ASC
       LIMIT 1`
    )

    if (fallbackSeller?.id) {
      await query(
        `UPDATE propostas p
         LEFT JOIN usuarios u ON u.id = p.responsavel_id AND u.ativo = TRUE
         SET p.responsavel_id = ?
         WHERE p.responsavel_id IS NULL OR p.responsavel_id = '' OR u.id IS NULL`,
        [fallbackSeller.id]
      )

      await query(
        `UPDATE tarefas t
         LEFT JOIN usuarios u ON u.id = t.responsavel_id AND u.ativo = TRUE
         SET t.responsavel_id = ?
         WHERE t.responsavel_id IS NULL OR t.responsavel_id = '' OR u.id IS NULL`,
        [fallbackSeller.id]
      )
    }
  })
}

export async function ensureCrmRuntimeSchema() {
  await runCached('ensureCrmRuntimeSchema', RUNTIME_BOOTSTRAP_CACHE_MS, async () => {
    await ensureUserManagementSchema()
    await ensureClientSchema()
    await ensureProposalStatusSchema()
    await ensureTaskSchema()
    await ensureResponsibilityIntegrity()
  })
}

async function deleteAutomatedTasks(propostaId: string) {
  await query(
    `DELETE FROM tarefas
     WHERE proposta_id = ?
       AND origem = 'automacao_proposta'
       AND status <> 'concluida'`,
    [propostaId]
  )
}

async function createAutomatedTask(params: {
  clienteId: string
  clienteNome: string
  responsavelId: string
  propostaId: string
  etapa: string
  titulo: string
  descricao: string
  dataHora: Date
}) {
  const tarefaId = uuidv4()

  await query(
    `INSERT INTO tarefas (
      id, titulo, descricao, tipo, data_hora, status, cliente_id, responsavel_id, proposta_id, automacao_etapa, origem
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tarefaId,
      params.titulo,
      params.descricao,
      'outro',
      formatDateTime(params.dataHora),
      'pendente',
      params.clienteId,
      params.responsavelId,
      params.propostaId,
      params.etapa,
      'automacao_proposta',
    ]
  )

  await query(
    `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
     VALUES (?, ?, ?, 'tarefa', ?, ?, ?)`,
    [
      uuidv4(),
      params.clienteId,
      params.responsavelId,
      `Tarefa automatica criada para a proposta do cliente ${params.clienteNome}: ${params.titulo}`,
      JSON.stringify({
        proposta_id: params.propostaId,
        automacao_etapa: params.etapa,
        tarefa_id: tarefaId,
        origem: 'automacao_proposta',
        silent_notification: true,
      }),
      formatDateTime(new Date()),
    ]
  )
}

async function createAutomationForStatus(params: {
  clienteId: string
  clienteNome: string
  propostaId: string
  responsavelId: string
  orcamentistaId?: string | null
  status: ProposalWorkflowStatus
  changedAt: Date
  followUpBaseAt?: Date | null
  followUpTime?: string | null
}) {
  const followUpBaseAt = params.followUpBaseAt ?? params.changedAt
  const followUpTime = params.followUpTime || null

  switch (params.status) {
    case 'em_orcamento':
      if (!params.orcamentistaId) return
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.orcamentistaId,
        propostaId: params.propostaId,
        etapa: 'em_orcamento',
        titulo: `Entregar orcamento do cliente ${params.clienteNome} em ate 2 dias`,
        descricao: 'Produzir e entregar o orcamento inicial da proposta.',
        dataHora: addDays(params.changedAt, 2),
      })
      return
    case 'em_retificacao':
      if (!params.orcamentistaId) return
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.orcamentistaId,
        propostaId: params.propostaId,
        etapa: 'em_retificacao',
        titulo: `Retificar orcamento do cliente ${params.clienteNome}`,
        descricao: 'Ajustar o orcamento com base no retorno comercial.',
        dataHora: addDays(params.changedAt, 1),
      })
      return
    case 'enviar_ao_cliente':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'enviar_ao_cliente',
        titulo: `Enviar proposta ao cliente ${params.clienteNome}`,
        descricao: 'Enviar a proposta ao cliente no mesmo dia apos a aprovacao.',
        dataHora: addHours(params.changedAt, 2),
      })
      return
    case 'enviado_ao_cliente':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_1_dia',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Entrar em contato com o cliente um dia apos o envio.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 1), followUpTime),
      })
      return
    case 'follow_up_1_dia':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_1_dia',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Entrar em contato com o cliente no primeiro follow-up.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 1), followUpTime),
      })
      return
    case 'aguardando_follow_up_3_dias':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_3_dias',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Realizar o follow-up em tres dias.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 3), followUpTime),
      })
      return
    case 'follow_up_3_dias':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_3_dias',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Realizar o follow-up em tres dias.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 3), followUpTime),
      })
      return
    case 'aguardando_follow_up_7_dias':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_7_dias',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Realizar o follow-up em sete dias.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 7), followUpTime),
      })
      return
    case 'follow_up_7_dias':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'follow_up_7_dias',
        titulo: `Fazer follow-up do cliente ${params.clienteNome}`,
        descricao: 'Realizar o follow-up em sete dias.',
        dataHora: applyTimeToDate(addDays(followUpBaseAt, 7), followUpTime),
      })
      return
    case 'fechado':
      await createAutomatedTask({
        clienteId: params.clienteId,
        clienteNome: params.clienteNome,
        responsavelId: params.responsavelId,
        propostaId: params.propostaId,
        etapa: 'fechado',
        titulo: `Fazer contrato do cliente ${params.clienteNome}`,
        descricao: 'Iniciar o fluxo de contrato logo apos o fechamento.',
        dataHora: addHours(params.changedAt, 2),
      })
      return
    default:
      return
  }
}

export async function handleProposalAutomationOnCreate(params: {
  clienteId: string
  clienteNome: string
  responsavelId: string
  orcamentistaId?: string | null
  propostaId: string
  status: ProposalWorkflowStatus
  createdAt: Date
  followUpBaseAt?: Date | null
  followUpTime?: string | null
}) {
  await deleteAutomatedTasks(params.propostaId)
  await createAutomationForStatus({
    clienteId: params.clienteId,
    clienteNome: params.clienteNome,
    propostaId: params.propostaId,
    responsavelId: params.responsavelId,
    orcamentistaId: params.orcamentistaId,
    status: params.status,
    changedAt: params.createdAt,
    followUpBaseAt: params.followUpBaseAt,
    followUpTime: params.followUpTime,
  })
}

export async function syncProposalAutomation(params: {
  propostaId: string
  clienteId: string
  clienteNome: string
  responsavelId: string
  orcamentistaId?: string | null
  previousStatus: ProposalWorkflowStatus
  newStatus: ProposalWorkflowStatus
  changedAt: Date
  followUpBaseAt?: Date | null
  followUpTime?: string | null
}) {
  await deleteAutomatedTasks(params.propostaId)

  if (params.previousStatus !== params.newStatus && params.newStatus === 'em_retificacao') {
    await query(
      `UPDATE propostas
       SET retificacoes_count = COALESCE(retificacoes_count, 0) + 1
       WHERE id = ?`,
      [params.propostaId]
    )
  }

  await createAutomationForStatus({
    clienteId: params.clienteId,
    clienteNome: params.clienteNome,
    propostaId: params.propostaId,
    responsavelId: params.responsavelId,
    orcamentistaId: params.orcamentistaId,
    status: params.newStatus,
    changedAt: params.changedAt,
    followUpBaseAt: params.followUpBaseAt,
    followUpTime: params.followUpTime,
  })
}

export async function syncDueFollowUpStatuses() {
  await runCached('syncDueFollowUpStatuses', RUNTIME_CACHE_MS, async () => {
    for (const step of FOLLOW_UP_SYNC_STEPS) {
      const propostas = await query<any[]>(
        `SELECT p.id, p.cliente_id, p.responsavel_id
         FROM propostas p
         INNER JOIN tarefas t
           ON t.proposta_id = p.id
          AND t.origem = 'automacao_proposta'
          AND t.automacao_etapa = ?
          AND t.status = 'pendente'
         WHERE p.status = ?
           AND t.data_hora <= NOW()`,
        [step.stage, step.from]
      )

      for (const proposta of propostas) {
        await query(`UPDATE propostas SET status = ? WHERE id = ?`, [step.to, proposta.id])
        await query(
          `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at)
           VALUES (?, ?, ?, 'proposta', ?, ?, ?)`,
          [
            uuidv4(),
            proposta.cliente_id,
             proposta.responsavel_id,
             `Proposta avancou automaticamente para ${step.to}`,
             JSON.stringify({
               proposta_id: proposta.id,
               novo_status: step.to,
               origem: 'automatizacao_follow_up',
               notification_kind: 'proposal_status',
             }),
             formatDateTime(new Date()),
           ]
         )
      }
    }
  })
}

export function isEarlyBudgetStatus(status: ProposalWorkflowStatus) {
  return ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(status)
}

export function isSellerFollowUpStatus(status: ProposalWorkflowStatus) {
  return ['enviado_ao_cliente', 'follow_up_1_dia', 'follow_up_3_dias', 'follow_up_7_dias', 'stand_by'].includes(status)
}

export function requiresOrcamentistaAssignment(status: ProposalWorkflowStatus) {
  return ['em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(status)
}

export function requiresPositiveProposalValue(status: ProposalWorkflowStatus) {
  return !['novo_cliente', 'em_orcamento', 'em_retificacao'].includes(status)
}

export function canOrcamentistaAccessProposal(proposta: {
  status: string
  orcamentista_id?: string | null
}, userId: string) {
  return (
    ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'].includes(proposta.status) &&
    (!proposta.orcamentista_id || proposta.orcamentista_id === userId)
  )
}
