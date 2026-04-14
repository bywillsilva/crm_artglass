import { useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import { normalizeModulePermissions } from '@/lib/auth/module-access'
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
  modulePermissions?: JsonRecord | null
}

type JsonRecord = Record<string, any>

const toDate = parseDateTimeValue

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseJsonObject(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
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
    case 'novo_cliente':
      return 'novo_cliente'
    case 'em_orcamento':
      return 'em_orcamento'
    case 'aguardando_aprovacao':
      return 'aguardando_aprovacao'
    case 'enviar_ao_cliente':
      return 'enviar_ao_cliente'
    case 'enviado_ao_cliente':
      return 'enviado_ao_cliente'
    case 'follow_up_1_dia':
      return 'follow_up_1_dia'
    case 'aguardando_follow_up_3_dias':
      return 'aguardando_follow_up_3_dias'
    case 'follow_up_3_dias':
      return 'follow_up_3_dias'
    case 'aguardando_follow_up_7_dias':
      return 'aguardando_follow_up_7_dias'
    case 'follow_up_7_dias':
      return 'follow_up_7_dias'
    case 'stand_by':
      return 'stand_by'
    case 'em_retificacao':
      return 'em_retificacao'
    case 'fechado':
      return 'fechado'
    case 'perdido':
      return 'perdido'
    case 'em_cotacao':
      return 'em_orcamento'
    case 'em_negociacao':
      return 'follow_up_1_dia'
    case 'rascunho':
      return 'em_orcamento'
    case 'enviada':
      return 'enviado_ao_cliente'
    case 'em_analise':
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

function mapPropostaStatusToApi(status?: StatusProposta | string) {
  switch (status) {
    case 'novo_cliente':
      return 'novo_cliente'
    case 'em_orcamento':
      return 'em_orcamento'
    case 'aguardando_aprovacao':
      return 'aguardando_aprovacao'
    case 'enviar_ao_cliente':
      return 'enviar_ao_cliente'
    case 'enviado_ao_cliente':
      return 'enviado_ao_cliente'
    case 'follow_up_1_dia':
      return 'follow_up_1_dia'
    case 'aguardando_follow_up_3_dias':
      return 'aguardando_follow_up_3_dias'
    case 'follow_up_3_dias':
      return 'follow_up_3_dias'
    case 'aguardando_follow_up_7_dias':
      return 'aguardando_follow_up_7_dias'
    case 'follow_up_7_dias':
      return 'follow_up_7_dias'
    case 'stand_by':
      return 'stand_by'
    case 'em_retificacao':
      return 'em_retificacao'
    case 'fechado':
      return 'fechado'
    case 'perdido':
      return 'perdido'
    default:
      return 'novo_cliente'
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
    origem: row.origem ?? '',
    observacoes: row.observacoes ?? '',
    status: (row.status ?? row.status_funil ?? 'lead_novo') as StatusFunil,
    valorEstimado: toNumber(row.valorEstimado ?? row.valor_potencial),
    ultimoContato: toDate(row.ultimoContato ?? row.updated_at ?? row.created_at),
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

function normalizeUsuario(row: JsonRecord): Usuario {
  const role = (row.role ?? 'vendedor') as Usuario['role']
  return {
    id: row.id,
    nome: row.nome ?? '',
    email: row.email ?? '',
    avatar: row.avatar ?? '',
    role,
    ativo: Boolean(row.ativo),
    metaVendas: toNumber(row.metaVendas ?? row.meta_vendas),
    modulePermissions: normalizeModulePermissions(
      parseJsonObject(row.modulePermissions ?? row.module_permissions ?? null),
      role
    ),
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
    propostaId: row.propostaId ?? row.proposta_id ?? '',
    automacaoEtapa: row.automacaoEtapa ?? row.automacao_etapa ?? null,
    origem: row.origem ?? 'manual',
    criadoEm: toDate(row.criadoEm ?? row.created_at),
  }
}

function normalizeProposta(row: JsonRecord): Proposta {
  return {
    id: row.id,
    clienteId: row.clienteId ?? row.cliente_id ?? '',
    clienteNome: row.clienteNome ?? row.cliente_nome ?? '',
    numero: row.numero ?? '',
    titulo: row.titulo ?? 'Proposta Comercial',
    valor: toNumber(row.valor_final ?? row.valor),
    descricao: row.descricao ?? '',
    status: mapPropostaStatusFromApi(row.status),
    responsavelId: row.responsavelId ?? row.responsavel_id ?? '',
    responsavelNome: row.responsavelNome ?? row.responsavel_nome ?? '',
    orcamentistaId: row.orcamentistaId ?? row.orcamentista_id ?? '',
    orcamentistaNome: row.orcamentistaNome ?? row.orcamentista_nome ?? '',
    retificacoesCount: toNumber(row.retificacoesCount ?? row.retificacoes_count),
    anexosCount: toNumber(row.anexosCount ?? row.anexos_count),
    comentariosCount: toNumber(row.comentariosCount ?? row.comentarios_count),
    anexos: Array.isArray(row.anexos)
      ? row.anexos.map((anexo: JsonRecord) => ({
          id: anexo.id,
          nome: anexo.nome_original ?? anexo.nome ?? '',
          url: anexo.url ?? '',
          tipoMime: anexo.tipo_mime ?? anexo.tipoMime ?? '',
          tamanho: toNumber(anexo.tamanho),
          usuarioId: anexo.usuario_id ?? anexo.usuarioId ?? '',
          criadoEm: toDate(anexo.created_at ?? anexo.criadoEm ?? row.created_at),
        }))
      : [],
    comentarios: Array.isArray(row.comentarios)
      ? row.comentarios.map((comentario: JsonRecord) => ({
          id: comentario.id,
          propostaId: comentario.proposta_id ?? comentario.propostaId ?? row.id,
          usuarioId: comentario.usuario_id ?? comentario.usuarioId ?? '',
          usuarioNome: comentario.usuario_nome ?? comentario.usuarioNome ?? '',
          comentario: comentario.comentario ?? '',
          criadoEm: toDate(comentario.created_at ?? comentario.criadoEm ?? row.created_at),
        }))
      : [],
    followUpBaseAt:
      row.followUpBaseAt ?? row.follow_up_base_at
        ? toDate(row.followUpBaseAt ?? row.follow_up_base_at)
        : null,
    followUpTime: row.followUpTime ?? row.follow_up_time ?? null,
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

function buildProposalFormData(payload: JsonRecord, anexos: File[]) {
  const formData = new FormData()

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      formData.append(key, JSON.stringify(value))
      return
    }
    formData.append(key, String(value))
  })

  anexos.forEach((file) => {
    formData.append('anexos', file)
  })

  return formData
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
  const clientes = useMemo(() => (data || []).map(normalizeCliente), [data])

  return {
    clientes,
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useCliente(id: string | null) {
  const key = id ? `/api/clientes/${id}` : null
  const { data, error, isLoading } = useSWR(key, fetcher)
  const cliente = useMemo(() => (data ? normalizeCliente(data) : undefined), [data])

  return {
    cliente,
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
  const tarefas = useMemo(() => (data || []).map(normalizeTarefa), [data])

  return {
    tarefas,
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
  const propostas = useMemo(() => (data || []).map(normalizeProposta), [data])

  return {
    propostas,
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useProposta(id: string | null) {
  const key = id ? `/api/propostas/${id}` : null
  const { data, error, isLoading } = useSWR(key, fetcher)
  const proposta = useMemo(() => (data ? normalizeProposta(data) : undefined), [data])

  return {
    proposta,
    isLoading,
    error,
    mutate: () => (key ? mutate(key) : undefined),
  }
}

// Hook para Usuarios
export function useUsuarios(params?: { role?: string; ativo?: string }) {
  const searchParams = new URLSearchParams()
  if (params?.role) searchParams.set('role', params.role)
  if (params?.ativo) searchParams.set('ativo', params.ativo)

  const url = `/api/usuarios${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher)
  const usuarios = useMemo(() => (data || []).map(normalizeUsuario), [data])

  return {
    usuarios,
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useUsuario(id: string | null) {
  const key = id ? `/api/usuarios/${id}` : null
  const { data, error, isLoading } = useSWR(key, fetcher)
  const usuario = useMemo(() => (data ? normalizeUsuario(data) : undefined), [data])

  return {
    usuario,
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
  const interacoes = useMemo(() => (data || []).map(normalizeInteracao), [data])

  return {
    interacoes,
    isLoading,
    error,
    mutate: () => (url ? mutate(url) : undefined),
  }
}

export function useSession() {
  const { data, error, isLoading, mutate: localMutate } = useSWR('/api/auth/session', fetcher)
  const user = useMemo(() => {
    if (!data?.user) return null
    const role = (data.user.role ?? 'vendedor') as Usuario['role']
    return {
      ...data.user,
      role,
      modulePermissions: normalizeModulePermissions(
        parseJsonObject(data.user.modulePermissions ?? null),
        role
      ),
    } as SessionUser & { role: Usuario['role'] }
  }, [data])

  return {
    user,
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
    origem: data.origem || null,
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
    origem: data.origem || null,
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
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    followUpTime: data.followUpTime || null,
  }
  const anexos = Array.isArray(data.anexos)
    ? (data.anexos as unknown[]).filter((item): item is File => item instanceof File)
    : []
  const isMultipart = anexos.some((item) => item instanceof File)
  const body = isMultipart ? buildProposalFormData(payload, anexos) : JSON.stringify(payload)
  const created = await requestJson('/api/propostas', {
    method: 'POST',
    ...(isMultipart ? {} : { headers: { 'Content-Type': 'application/json' } }),
    body,
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
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    clienteId: data.clienteId || null,
    followUpTime: data.followUpTime || null,
  }
  const anexos = Array.isArray(data.anexos)
    ? (data.anexos as unknown[]).filter((item): item is File => item instanceof File)
    : []
  const isMultipart = anexos.some((item) => item instanceof File)
  const body = isMultipart ? buildProposalFormData(payload, anexos) : JSON.stringify(payload)
  const updated = await requestJson(`/api/propostas/${id}`, {
    method: 'PUT',
    ...(isMultipart ? {} : { headers: { 'Content-Type': 'application/json' } }),
    body,
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
    orcamentistaId: propostaAtual.orcamentista_id ?? propostaAtual.orcamentistaId,
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
