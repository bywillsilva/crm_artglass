import useSWR, { mutate } from 'swr'
import {
  formatDateOnlyLocalValue,
  formatMysqlDateTimeValue,
  parseDateTimeValue,
} from '@/lib/utils/date-time'
import { getDateFilterQueryParams, type DateFilterValue } from '@/lib/utils/date-filter'
import type {
  Cliente,
  Interacao,
  Proposta,
  StatusFunil,
  StatusProposta,
  StatusTarefa,
  Tarefa,
  TipoCliente,
  TipoInteracao,
  Usuario,
} from '@/lib/data/types'

type SessionUser = {
  id: string
  nome: string
  email: string
  avatar: string
  role: string
  ativo: boolean
}

type JsonRecord = Record<string, any>

const toDate = parseDateTimeValue

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function joinAddress(row: JsonRecord) {
  const parts = [row.endereco, row.cidade, row.estado, row.cep].filter(Boolean)
  return parts.join(', ')
}

function inferTipoCliente(row: JsonRecord): TipoCliente {
  return row.empresa || row.cargo ? 'comercial' : 'residencial'
}

function mapPropostaStatusFromApi(status?: string): StatusProposta {
  switch (status) {
    case 'em_cotacao':
      return 'em_cotacao'
    case 'enviado_ao_cliente':
      return 'enviado_ao_cliente'
    case 'em_negociacao':
      return 'em_negociacao'
    case 'em_retificacao':
      return 'em_retificacao'
    case 'fechado':
      return 'fechado'
    case 'perdido':
      return 'perdido'
    case 'rascunho':
      return 'em_cotacao'
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

function mapPropostaStatusToApi(status?: StatusProposta | string) {
  switch (status) {
    case 'em_cotacao':
      return 'em_cotacao'
    case 'enviado_ao_cliente':
      return 'enviado_ao_cliente'
    case 'em_negociacao':
      return 'em_negociacao'
    case 'em_retificacao':
      return 'em_retificacao'
    case 'fechado':
      return 'fechado'
    case 'perdido':
      return 'perdido'
    default:
      return 'em_cotacao'
  }
}

function normalizeCliente(row: JsonRecord): Cliente {
  return {
    id: row.id,
    nome: row.nome ?? '',
    telefone: row.telefone ?? '',
    email: row.email ?? '',
    empresa: row.empresa ?? '',
    cargo: row.cargo ?? '',
    endereco: joinAddress(row),
    tipo: inferTipoCliente(row),
    origem: row.origem ?? 'site',
    observacoes: row.observacoes ?? '',
    status: (row.status ?? row.status_funil ?? 'lead_novo') as StatusFunil,
    valorEstimado: toNumber(row.valorEstimado ?? row.valor_potencial),
    ultimoContato: toDate(row.ultimoContato ?? row.updated_at ?? row.created_at),
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

function normalizeUsuario(row: JsonRecord): Usuario {
  return {
    id: row.id,
    nome: row.nome ?? '',
    email: row.email ?? '',
    avatar: row.avatar ?? '',
    role: row.role ?? 'vendedor',
    ativo: Boolean(row.ativo),
    metaVendas: toNumber(row.metaVendas ?? row.meta_vendas),
  }
}

function normalizeTarefa(row: JsonRecord): Tarefa {
  return {
    id: row.id,
    clienteId: row.clienteId ?? row.cliente_id ?? '',
    titulo: row.titulo ?? row.descricao ?? '',
    descricao: row.descricao ?? row.titulo ?? '',
    dataHora: toDate(row.dataHora ?? row.data_hora),
    status: (row.status === 'cancelada' ? 'pendente' : row.status ?? 'pendente') as StatusTarefa,
    tipo: row.tipo ?? 'ligacao',
    responsavelId: row.responsavelId ?? row.responsavel_id ?? '',
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

function normalizeProposta(row: JsonRecord): Proposta {
  return {
    id: row.id,
    clienteId: row.clienteId ?? row.cliente_id ?? '',
    titulo: row.titulo ?? 'Proposta Comercial',
    valor: toNumber(row.valor_final ?? row.valor),
    descricao: row.descricao ?? row.titulo ?? '',
    status: mapPropostaStatusFromApi(row.status),
    responsavelId: row.responsavelId ?? row.responsavel_id ?? '',
    dataEnvio: toDate(row.dataEnvio ?? row.created_at ?? row.validade),
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

function normalizeInteracao(row: JsonRecord): Interacao {
  const tipo = (row.tipo ?? 'email') as TipoInteracao
  return {
    id: row.id,
    clienteId: row.clienteId ?? row.cliente_id ?? '',
    tipo,
    descricao: row.descricao ?? '',
    usuarioId: row.usuarioId ?? row.usuario_id ?? '',
    dados:
      typeof row.dados === 'string'
        ? JSON.parse(row.dados || 'null')
        : row.dados ?? null,
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Erro na requisicao')
  }

  return data
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data?.error || 'Erro na requisicao')
  }

  return data as T
}

function mutateByPrefix(prefix: string) {
  mutate((key) => typeof key === 'string' && key.startsWith(prefix))
}

// Hook para Dashboard
export function useDashboard(filter?: DateFilterValue) {
  const queryString = filter ? getDateFilterQueryParams(filter) : ''
  const url = `/api/dashboard${queryString ? `?${queryString}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher, {
    refreshInterval: 30000,
  })

  return {
    data,
    isLoading,
    error,
  }
}

// Hook para Clientes
export function useClientes(params?: { status?: string; responsavel?: string; search?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.responsavel) searchParams.set('responsavel', params.responsavel)
  if (params?.search) searchParams.set('search', params.search)

  const url = `/api/clientes${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher)

  return {
    clientes: (data || []).map(normalizeCliente),
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useCliente(id: string | null) {
  const key = id ? `/api/clientes/${id}` : null
  const { data, error, isLoading } = useSWR(key, fetcher)

  return {
    cliente: data ? normalizeCliente(data) : undefined,
    isLoading,
    error,
    mutate: () => (key ? mutate(key) : undefined),
  }
}

// Hook para Tarefas
export function useTarefas(params?: { status?: string; tipo?: string; responsavel?: string; clienteId?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.tipo) searchParams.set('tipo', params.tipo)
  if (params?.responsavel) searchParams.set('responsavel', params.responsavel)
  if (params?.clienteId) searchParams.set('cliente_id', params.clienteId)

  const url = `/api/tarefas${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher)

  return {
    tarefas: (data || []).map(normalizeTarefa),
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

// Hook para Propostas
export function usePropostas(params?: { status?: string; clienteId?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.clienteId) searchParams.set('cliente_id', params.clienteId)

  const url = `/api/propostas${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher)

  return {
    propostas: (data || []).map(normalizeProposta),
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

// Hook para Usuarios
export function useUsuarios(params?: { role?: string; ativo?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.role) searchParams.set('role', params.role)
  if (params?.ativo) searchParams.set('ativo', params.ativo)

  const url = `/api/usuarios${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher)

  return {
    usuarios: (data || []).map(normalizeUsuario),
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useUsuario(id: string | null) {
  const key = id ? `/api/usuarios/${id}` : null
  const { data, error, isLoading } = useSWR(key, fetcher)

  return {
    usuario: data ? normalizeUsuario(data) : undefined,
    isLoading,
    error,
    mutate: () => (key ? mutate(key) : undefined),
  }
}

// Hook para Interacoes
export function useInteracoes(clienteId?: string | null) {
  const url =
    clienteId === null
      ? null
      : clienteId
        ? `/api/interacoes?cliente_id=${clienteId}`
        : '/api/interacoes'

  const { data, error, isLoading } = useSWR(url, fetcher)

  return {
    interacoes: (data || []).map(normalizeInteracao),
    isLoading,
    error,
    mutate: () => (url ? mutate(url) : undefined),
  }
}

export function useSession() {
  const { data, error, isLoading, mutate: localMutate } = useSWR('/api/auth/session', fetcher)

  return {
    user: (data?.user ?? null) as SessionUser | null,
    error,
    isLoading,
    mutate: localMutate,
  }
}

// Funcoes de mutacao (CRUD)
export async function createCliente(data: Partial<Cliente> & JsonRecord) {
  const payload = {
    nome: data.nome,
    email: data.email || null,
    telefone: data.telefone || null,
    endereco: data.endereco || null,
    origem: data.origem || 'site',
    statusFunil: data.statusFunil || data.status || 'lead_novo',
    valorPotencial: data.valorPotencial ?? data.valorEstimado ?? 0,
    observacoes: data.observacoes || null,
    empresa: data.empresa || null,
    cargo: data.cargo || null,
    cidade: data.cidade || null,
    estado: data.estado || null,
    cep: data.cep || null,
  }

  const created = await requestJson('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return created
}

export async function updateCliente(id: string, data: Partial<Cliente> & JsonRecord) {
  const payload = {
    nome: data.nome,
    email: data.email || null,
    telefone: data.telefone || null,
    endereco: data.endereco || null,
    origem: data.origem || 'site',
    statusFunil: data.statusFunil || data.status || 'lead_novo',
    valorPotencial: data.valorPotencial ?? data.valorEstimado ?? 0,
    observacoes: data.observacoes || null,
    empresa: data.empresa || null,
    cargo: data.cargo || null,
    cidade: data.cidade || null,
    estado: data.estado || null,
    cep: data.cep || null,
  }

  const updated = await requestJson(`/api/clientes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return updated
}

export async function deleteCliente(id: string) {
  const deleted = await requestJson(`/api/clientes/${id}`, { method: 'DELETE' })
  mutateByPrefix('/api/clientes')
  mutateByPrefix('/api/tarefas')
  mutateByPrefix('/api/propostas')
  mutateByPrefix('/api/interacoes')
  mutate('/api/dashboard')
  return deleted
}

export async function createTarefa(data: Partial<Tarefa> & JsonRecord) {
  const payload = {
    titulo: data.titulo || data.descricao || 'Tarefa',
    descricao: data.descricao || data.titulo || '',
    tipo: data.tipo || 'ligacao',
    dataHora: formatMysqlDateTimeValue(data.dataHora as string | Date | null | undefined),
    status: data.status || 'pendente',
    clienteId: data.clienteId,
    responsavelId: data.responsavelId,
  }

  const created = await requestJson('/api/tarefas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/tarefas')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return created
}

export async function updateTarefa(id: string, data: Partial<Tarefa> & JsonRecord) {
  const payload = {
    titulo: data.titulo || data.descricao || 'Tarefa',
    descricao: data.descricao || data.titulo || '',
    tipo: data.tipo || 'ligacao',
    dataHora: formatMysqlDateTimeValue(data.dataHora as string | Date | null | undefined),
    status: data.status || 'pendente',
    clienteId: data.clienteId,
    responsavelId: data.responsavelId,
  }

  const updated = await requestJson(`/api/tarefas/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/tarefas')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return updated
}

export async function updateTarefaStatus(id: string, status: StatusTarefa) {
  const updated = await requestJson(`/api/tarefas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })

  mutateByPrefix('/api/tarefas')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return updated
}

export async function deleteTarefa(id: string) {
  const deleted = await requestJson(`/api/tarefas/${id}`, { method: 'DELETE' })
  mutateByPrefix('/api/tarefas')
  mutate('/api/dashboard')
  return deleted
}

export async function createProposta(data: Partial<Proposta> & JsonRecord) {
  const payload = {
    clienteId: data.clienteId,
    titulo: data.titulo || 'Proposta Comercial',
    descricao: data.descricao || '',
    valor: data.valor ?? 0,
    desconto: data.desconto || 0,
    status: mapPropostaStatusToApi(data.status),
    validade:
      data.validade ||
      formatDateOnlyLocalValue(data.dataEnvio ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 15)),
    servicos: data.servicos || [],
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
  }

  const created = await requestJson('/api/propostas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/propostas')
  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return created
}

export async function updateProposta(id: string, data: Partial<Proposta> & JsonRecord) {
  const payload = {
    titulo: data.titulo || 'Proposta Comercial',
    descricao: data.descricao || '',
    valor: data.valor ?? 0,
    desconto: data.desconto || 0,
    status: mapPropostaStatusToApi(data.status),
    validade: data.validade || null,
    servicos: data.servicos || [],
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
  }

  const updated = await requestJson(`/api/propostas/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/propostas')
  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return updated
}

export async function updatePropostaStatus(id: string, status: StatusProposta) {
  const propostaAtual = await requestJson<JsonRecord>(`/api/propostas/${id}`)
  return updateProposta(id, {
    titulo: propostaAtual.titulo,
    descricao: propostaAtual.descricao,
    valor: toNumber(propostaAtual.valor),
    desconto: toNumber(propostaAtual.desconto),
    status,
    validade: propostaAtual.validade,
    servicos:
      typeof propostaAtual.servicos === 'string'
        ? JSON.parse(propostaAtual.servicos)
        : propostaAtual.servicos || [],
    condicoes: propostaAtual.condicoes,
    responsavelId: propostaAtual.responsavel_id ?? propostaAtual.responsavelId,
  })
}

export async function deleteProposta(id: string) {
  const deleted = await requestJson(`/api/propostas/${id}`, { method: 'DELETE' })
  mutateByPrefix('/api/propostas')
  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  return deleted
}

export async function createUsuario(data: Partial<Usuario> & JsonRecord) {
  const created = await requestJson('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  mutateByPrefix('/api/usuarios')
  return created
}

export async function updateUsuario(id: string, data: Partial<Usuario> & JsonRecord) {
  const updated = await requestJson(`/api/usuarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  mutateByPrefix('/api/usuarios')
  return updated
}

export async function deleteUsuario(id: string) {
  const deleted = await requestJson(`/api/usuarios/${id}`, { method: 'DELETE' })
  mutateByPrefix('/api/usuarios')
  return deleted
}

export async function createInteracao(data: Partial<Interacao> & JsonRecord) {
  const payload = {
    clienteId: data.clienteId,
    usuarioId: data.usuarioId,
    tipo: (data.tipo || 'email') as TipoInteracao,
    descricao: data.descricao || '',
    dados: data.dados || null,
  }

  const created = await requestJson('/api/interacoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  mutateByPrefix('/api/interacoes')
  mutateByPrefix('/api/clientes')
  mutate('/api/dashboard')
  return created
}

export async function saveConfiguracao(chave: string, valor: any) {
  return requestJson('/api/configuracoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave, valor }),
  })
}

export async function initDatabase() {
  return requestJson('/api/init', { method: 'POST' })
}

export async function checkDatabase() {
  return requestJson('/api/init')
}
