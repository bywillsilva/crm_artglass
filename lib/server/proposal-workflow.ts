import { v4 as uuidv4 } from 'uuid'
import { query } from '@/lib/db/mysql'

export type ProposalWorkflowStatus =
  | 'em_cotacao'
  | 'enviado_ao_cliente'
  | 'em_negociacao'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'

const LEGACY_STATUSES = ['rascunho', 'enviada', 'em_analise', 'aprovada', 'rejeitada', 'expirada']
const FINAL_STATUSES: ProposalWorkflowStatus[] = [
  'em_cotacao',
  'enviado_ao_cliente',
  'em_negociacao',
  'em_retificacao',
  'fechado',
  'perdido',
]

export function normalizeProposalStatus(status?: string | null): ProposalWorkflowStatus {
  switch (status) {
    case 'enviado_ao_cliente':
    case 'em_negociacao':
    case 'em_retificacao':
    case 'fechado':
    case 'perdido':
    case 'em_cotacao':
      return status
    case 'enviada':
      return 'enviado_ao_cliente'
    case 'em_analise':
      return 'em_negociacao'
    case 'aprovada':
      return 'fechado'
    case 'rejeitada':
    case 'expirada':
      return 'perdido'
    default:
      return 'em_cotacao'
  }
}

export async function ensureProposalStatusSchema() {
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

  if (!hasLegacyStatuses && hasFinalStatuses) {
    return
  }

  await query(`
    ALTER TABLE propostas
    MODIFY COLUMN status ENUM(
      'rascunho',
      'enviada',
      'em_analise',
      'aprovada',
      'rejeitada',
      'expirada',
      'em_cotacao',
      'enviado_ao_cliente',
      'em_negociacao',
      'em_retificacao',
      'fechado',
      'perdido'
    ) DEFAULT 'em_cotacao'
  `)

  await query(`UPDATE propostas SET status = 'em_cotacao' WHERE status = 'rascunho'`)
  await query(`UPDATE propostas SET status = 'enviado_ao_cliente' WHERE status = 'enviada'`)
  await query(`UPDATE propostas SET status = 'em_negociacao' WHERE status = 'em_analise'`)
  await query(`UPDATE propostas SET status = 'fechado' WHERE status = 'aprovada'`)
  await query(`UPDATE propostas SET status = 'perdido' WHERE status IN ('rejeitada', 'expirada')`)

  await query(`
    ALTER TABLE propostas
    MODIFY COLUMN status ENUM(
      'em_cotacao',
      'enviado_ao_cliente',
      'em_negociacao',
      'em_retificacao',
      'fechado',
      'perdido'
    ) DEFAULT 'em_cotacao'
  `)
}

export async function ensureTaskSchema() {
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
}

export async function ensureResponsibilityIntegrity() {
  const [fallbackUser] = await query<any[]>(
    `SELECT id
     FROM usuarios
     WHERE ativo = TRUE
     ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`
  )

  if (!fallbackUser?.id) {
    return
  }

  await query(
    `UPDATE propostas p
     LEFT JOIN usuarios u ON u.id = p.responsavel_id AND u.ativo = TRUE
     SET p.responsavel_id = ?
     WHERE p.responsavel_id IS NULL OR p.responsavel_id = '' OR u.id IS NULL`,
    [fallbackUser.id]
  )

  await query(
    `UPDATE tarefas t
     LEFT JOIN usuarios u ON u.id = t.responsavel_id AND u.ativo = TRUE
     SET t.responsavel_id = ?
     WHERE t.responsavel_id IS NULL OR t.responsavel_id = '' OR u.id IS NULL`,
    [fallbackUser.id]
  )
}

export function formatDateTime(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
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

async function concludeAutomatedTasks(propostaId: string, stages?: ProposalWorkflowStatus[]) {
  let sql = `
    UPDATE tarefas
    SET status = 'concluida'
    WHERE proposta_id = ?
      AND origem = 'automacao_proposta'
      AND status <> 'concluida'
  `
  const params: unknown[] = [propostaId]

  if (stages && stages.length > 0) {
    sql += ` AND automacao_etapa IN (${stages.map(() => '?').join(', ')})`
    params.push(...stages)
  }

  await query(sql, params)
}

async function createAutomatedTask(params: {
  clienteId: string
  responsavelId: string
  propostaId: string
  etapa: ProposalWorkflowStatus
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
    `INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados)
     VALUES (?, ?, ?, 'tarefa', ?, ?)`,
    [
      uuidv4(),
      params.clienteId,
      params.responsavelId,
      `Tarefa automatica criada para a etapa ${params.etapa}: ${params.titulo}`,
      JSON.stringify({
        proposta_id: params.propostaId,
        automacao_etapa: params.etapa,
        tarefa_id: tarefaId,
        origem: 'automacao_proposta',
        silent_notification: true,
      }),
    ]
  )
}

export async function handleProposalAutomationOnCreate(params: {
  clienteId: string
  responsavelId: string
  propostaId: string
  status: ProposalWorkflowStatus
  createdAt: Date
}) {
  if (params.status !== 'em_cotacao') return

  await createAutomatedTask({
    clienteId: params.clienteId,
    responsavelId: params.responsavelId,
    propostaId: params.propostaId,
    etapa: 'em_cotacao',
    titulo: 'Preparar orcamento da proposta',
    descricao: 'Concluir o orcamento da proposta em ate 2 dias.',
    dataHora: addDays(params.createdAt, 2),
  })
}

export async function syncProposalAutomation(params: {
  propostaId: string
  clienteId: string
  responsavelId: string
  newStatus: ProposalWorkflowStatus
  changedAt: Date
}) {
  if (params.newStatus === 'em_cotacao') {
    await concludeAutomatedTasks(params.propostaId)
    await createAutomatedTask({
      clienteId: params.clienteId,
      responsavelId: params.responsavelId,
      propostaId: params.propostaId,
      etapa: 'em_cotacao',
      titulo: 'Preparar orcamento da proposta',
      descricao: 'Concluir o orcamento da proposta em ate 2 dias.',
      dataHora: addDays(params.changedAt, 2),
    })
    return
  }

  if (params.newStatus === 'enviado_ao_cliente') {
    await concludeAutomatedTasks(params.propostaId, ['em_cotacao'])
    await createAutomatedTask({
      clienteId: params.clienteId,
      responsavelId: params.responsavelId,
      propostaId: params.propostaId,
      etapa: 'enviado_ao_cliente',
      titulo: 'Fazer follow-up com o cliente',
      descricao: 'Entrar em contato 1 dia apos o envio da proposta.',
      dataHora: addDays(params.changedAt, 1),
    })
    return
  }

  if (params.newStatus === 'em_negociacao') {
    await concludeAutomatedTasks(params.propostaId)
    return
  }

  if (params.newStatus === 'em_retificacao') {
    await concludeAutomatedTasks(params.propostaId)
    await createAutomatedTask({
      clienteId: params.clienteId,
      responsavelId: params.responsavelId,
      propostaId: params.propostaId,
      etapa: 'em_retificacao',
      titulo: 'Retificar proposta',
      descricao: 'Realizar a retificacao solicitada em ate 1 dia.',
      dataHora: addDays(params.changedAt, 1),
    })
    return
  }

  if (params.newStatus === 'fechado') {
    await concludeAutomatedTasks(params.propostaId)
    await createAutomatedTask({
      clienteId: params.clienteId,
      responsavelId: params.responsavelId,
      propostaId: params.propostaId,
      etapa: 'fechado',
      titulo: 'Iniciar pos-venda da proposta fechada',
      descricao: 'Realizar o proximo passo 2 horas apos o fechamento.',
      dataHora: addHours(params.changedAt, 2),
    })
    return
  }

  await concludeAutomatedTasks(params.propostaId)
}
