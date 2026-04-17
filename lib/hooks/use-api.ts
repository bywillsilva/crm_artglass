import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { mutate, useSWRConfig } from 'swr'
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
const READ_ONLY_SWR_OPTIONS = {
  shouldRetryOnError: false,
  errorRetryCount: 0,
  revalidateOnReconnect: false,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  dedupingInterval: 30000,
} as const

const REALTIME_REVALIDATE_PREFIXES = [
  '/api/crm/bootstrap',
  '/api/clientes',
  '/api/propostas',
  '/api/tarefas',
  '/api/interacoes',
  '/api/usuarios',
  '/api/dashboard',
  '/api/configuracoes',
] as const

const MODULE_REALTIME_PREFIXES: Record<string, readonly string[]> = {
  clientes: ['/api/crm/bootstrap', '/api/clientes', '/api/dashboard'],
  propostas: ['/api/crm/bootstrap', '/api/propostas', '/api/tarefas', '/api/dashboard'],
  tarefas: ['/api/crm/bootstrap', '/api/tarefas', '/api/dashboard'],
  usuarios: ['/api/crm/bootstrap', '/api/usuarios'],
  interacoes: ['/api/interacoes'],
  configuracoes: ['/api/configuracoes'],
  global: REALTIME_REVALIDATE_PREFIXES,
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseNumberLike(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const normalized = trimmed
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function hasFilledValue(value: unknown) {
  if (value === undefined || value === null) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return true
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
    cpf: row.cpf ?? '',
    telefone: row.telefone ?? '',
    email: row.email ?? '',
    empresa: row.empresa ?? '',
    cargo: row.cargo ?? '',
    endereco: joinAddress(row),
    tipo: inferTipoCliente(row),
    origem: row.origem ?? '',
    observacoes: row.observacoes ?? '',
    status: (row.status ?? row.status_funil ?? 'lead_novo') as StatusFunil,
    responsavelId: row.responsavelId ?? row.responsavel_id ?? '',
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
    clienteId: row.clienteId ?? row.cliente_id_resolvido ?? row.cliente_id ?? '',
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
    valor: toNumber(row.valor ?? row.valor_final),
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
      : undefined,
    comentarios: Array.isArray(row.comentarios)
      ? row.comentarios.map((comentario: JsonRecord) => ({
          id: comentario.id,
          propostaId: comentario.proposta_id ?? comentario.propostaId ?? row.id,
          usuarioId: comentario.usuario_id ?? comentario.usuarioId ?? '',
          usuarioNome: comentario.usuario_nome ?? comentario.usuarioNome ?? '',
          comentario: comentario.comentario ?? '',
          criadoEm: toDate(comentario.created_at ?? comentario.criadoEm ?? row.created_at),
        }))
      : undefined,
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

async function parseResponseBody(res: Response) {
  const text = await res.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await parseResponseBody(res)

  if (!res.ok) {
    throw new Error(
      (typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null) || `Erro na requisicao (${res.status})`
    )
  }

  return data
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await parseResponseBody(res)

  if (!res.ok) {
    throw new Error(
      (typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null) || `Erro na requisicao (${res.status})`
    )
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

type BootstrapCollectionKey = 'clientes' | 'usuarios' | 'tarefas' | 'propostas'

function mutateBootstrapCollection(
  collection: BootstrapCollectionKey,
  updater: (items: JsonRecord[]) => JsonRecord[]
) {
  return mutate(
    (key) => typeof key === 'string' && key.startsWith('/api/crm/bootstrap'),
    (current?: JsonRecord | null) => {
      if (!current || typeof current !== 'object') {
        return current
      }

      const items = Array.isArray(current[collection]) ? (current[collection] as JsonRecord[]) : []
      return {
        ...current,
        [collection]: updater(items),
      }
    },
    { revalidate: false }
  )
}

function prependBootstrapEntity(collection: BootstrapCollectionKey, entity: JsonRecord) {
  return mutateBootstrapCollection(collection, (items) => {
    const entityId = entity?.id
    if (!entityId) {
      return [entity, ...items]
    }

    return [entity, ...items.filter((item) => item?.id !== entityId)]
  })
}

function patchBootstrapEntity(collection: BootstrapCollectionKey, id: string, patch: JsonRecord) {
  return mutateBootstrapCollection(collection, (items) =>
    items.map((item) => (item?.id === id ? { ...item, ...patch } : item))
  )
}

function removeBootstrapEntity(collection: BootstrapCollectionKey, id: string) {
  return mutateBootstrapCollection(collection, (items) => items.filter((item) => item?.id !== id))
}

export function revalidateRealtimeData() {
  REALTIME_REVALIDATE_PREFIXES.forEach((prefix) => {
    mutate((key) => typeof key === 'string' && key.startsWith(prefix))
  })
}

function revalidateRealtimeModules(modules: string[]) {
  const prefixes = new Set<string>()

  for (const moduleName of modules) {
    const modulePrefixes = MODULE_REALTIME_PREFIXES[moduleName] || MODULE_REALTIME_PREFIXES.global
    for (const prefix of modulePrefixes) {
      prefixes.add(prefix)
    }
  }

  if (prefixes.size === 0) {
    revalidateRealtimeData()
    return
  }

  for (const prefix of prefixes) {
    mutate((key) => typeof key === 'string' && key.startsWith(prefix))
  }
}

function updateCachedEntity(current: any, id: string, patch: JsonRecord) {
  if (!current) {
    return current
  }

  if (Array.isArray(current)) {
    return current.map((item) => {
      if (!item || item.id !== id) {
        return item
      }

      return { ...item, ...patch }
    })
  }

  if (typeof current === 'object' && current.id === id) {
    return { ...current, ...patch }
  }

  return current
}

function compactObject<T extends JsonRecord>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T
}

function mutateEntityByPrefix(prefix: string, id: string, patch: JsonRecord) {
  return mutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    (current) => updateCachedEntity(current, id, patch),
    { revalidate: false }
  )
}

function prependCachedEntity(current: any, entity: JsonRecord) {
  if (!Array.isArray(current)) {
    return current
  }

  const entityId = entity?.id
  if (!entityId) {
    return [entity, ...current]
  }

  return [entity, ...current.filter((item) => item?.id !== entityId)]
}

function removeCachedEntity(current: any, id: string) {
  if (!Array.isArray(current)) {
    return current
  }

  return current.filter((item) => item?.id !== id)
}

function prependEntityToKey(key: string, entity: JsonRecord) {
  return mutate(key, (current) => prependCachedEntity(current, entity), { revalidate: false })
}

function mergeCachedEntities(current: any, incoming: JsonRecord[]) {
  if (!Array.isArray(current) || incoming.length === 0) {
    return current
  }

  const incomingById = new Map(
    incoming
      .filter((item) => item?.id)
      .map((item) => [String(item.id), item] as const)
  )

  const merged = current.map((item) => {
    if (!item?.id) {
      return item
    }

    const next = incomingById.get(String(item.id))
    if (!next) {
      return item
    }

    incomingById.delete(String(item.id))
    return { ...item, ...next }
  })

  for (const entity of incomingById.values()) {
    merged.unshift(entity)
  }

  return merged
}

function removeEntityFromPrefix(prefix: string, id: string) {
  return mutate(
    (key) => typeof key === 'string' && key.startsWith(prefix),
    (current) => removeCachedEntity(current, id),
    { revalidate: false }
  )
}

function getBootstrapCollectionFromCache(
  cache: ReturnType<typeof useSWRConfig>['cache'],
  collection: BootstrapCollectionKey
) {
  const candidates = Array.from(cache.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith('/api/crm/bootstrap')
  )

  const prioritizedKeys = [
    '/api/crm/bootstrap',
    ...candidates.filter((key) => key !== '/api/crm/bootstrap'),
  ]

  for (const key of prioritizedKeys) {
    const bootstrap = cache.get(key) as JsonRecord | undefined
    const items = bootstrap?.[collection]
    if (Array.isArray(items)) {
      return items
    }
  }

  return undefined
}

function getProposalSnapshotFromCache(
  cache: ReturnType<typeof useSWRConfig>['cache'],
  id: string
) {
  const directKey = `/api/propostas/${id}`
  const direct = cache.get(directKey)
  if (direct && typeof direct === 'object') {
    return direct as JsonRecord
  }

  const bootstrapItems = getBootstrapCollectionFromCache(cache, 'propostas')
  if (Array.isArray(bootstrapItems)) {
    const bootstrapMatch = bootstrapItems.find((item) => String(item?.id ?? '') === id)
    if (bootstrapMatch && typeof bootstrapMatch === 'object') {
      return bootstrapMatch as JsonRecord
    }
  }

  const proposalCollectionKeys = Array.from(cache.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith('/api/propostas')
  )

  for (const key of proposalCollectionKeys) {
    const cachedValue = cache.get(key)
    if (!Array.isArray(cachedValue)) {
      continue
    }

    const match = cachedValue.find((item) => String(item?.id ?? '') === id)
    if (match && typeof match === 'object') {
      return match as JsonRecord
    }
  }

  return undefined
}

function mergeBootstrapCollection(collection: BootstrapCollectionKey, incoming: JsonRecord[]) {
  return mutate(
    (key) => typeof key === 'string' && key.startsWith('/api/crm/bootstrap'),
    (current?: JsonRecord | null) => {
      if (!current || typeof current !== 'object') {
        return current
      }

      const items = Array.isArray(current[collection]) ? (current[collection] as JsonRecord[]) : []
      return {
        ...current,
        [collection]: mergeCachedEntities(items, incoming),
      }
    },
    { revalidate: false }
  )
}

async function syncIncrementalModule(
  moduleName: string,
  changedAt: string | undefined,
  previousChangedAt: string | undefined
) {
  if (!previousChangedAt || !changedAt || changedAt <= previousChangedAt) {
    revalidateRealtimeModules([moduleName])
    return
  }

  const endpointByModule: Partial<Record<string, string>> = {
    clientes: '/api/clientes',
    tarefas: '/api/tarefas',
    propostas: '/api/propostas',
  }

  const collectionByModule: Partial<Record<string, BootstrapCollectionKey>> = {
    clientes: 'clientes',
    tarefas: 'tarefas',
    propostas: 'propostas',
  }

  const endpoint = endpointByModule[moduleName]
  const collection = collectionByModule[moduleName]

  if (!endpoint || !collection) {
    revalidateRealtimeModules([moduleName])
    return
  }

  try {
    const result = await requestJson<JsonRecord[]>(
      `${endpoint}?updated_since=${encodeURIComponent(previousChangedAt)}`
    )

    if (!Array.isArray(result) || result.length === 0) {
      return
    }

    await mutate(
      (key) => typeof key === 'string' && key.startsWith(endpoint),
      (current) => mergeCachedEntities(current, result),
      { revalidate: false }
    )
    await mergeBootstrapCollection(collection, result)
  } catch {
    revalidateRealtimeModules([moduleName])
  }
}

// Hook para Dashboard
export function useDashboard(filter?: DateFilterValue) {
  const queryString = filter ? getDateFilterQueryParams(filter) : ''
  const url = `/api/dashboard${queryString ? `?${queryString}` : ''}`
  const { data, error, isLoading } = useSWR(url, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    refreshInterval: 120000,
  })

  return {
    data,
    isLoading,
    error,
  }
}

export function useCrmBootstrap(sections?: BootstrapCollectionKey[]) {
  const key =
    sections && sections.length > 0
      ? `/api/crm/bootstrap?sections=${sections.join(',')}`
      : '/api/crm/bootstrap'
  const { data, error, isLoading, mutate: localMutate } = useSWR(key, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    dedupingInterval: 45000,
  })

  const clientes = useMemo(() => (data?.clientes || []).map(normalizeCliente), [data?.clientes])
  const usuarios = useMemo(() => (data?.usuarios || []).map(normalizeUsuario), [data?.usuarios])
  const tarefas = useMemo(() => (data?.tarefas || []).map(normalizeTarefa), [data?.tarefas])
  const propostas = useMemo(() => (data?.propostas || []).map(normalizeProposta), [data?.propostas])

  return {
    clientes,
    usuarios,
    tarefas,
    propostas,
    isLoading,
    error,
    mutate: localMutate,
  }
}

// Hook para Clientes
export function useClientes(params?: { status?: string; responsavel?: string; search?: string }) {
  const { cache } = useSWRConfig()
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.responsavel) searchParams.set('responsavel', params.responsavel)
  if (params?.search) searchParams.set('search', params.search)
  if ((params as JsonRecord | undefined)?.updatedSince) {
    searchParams.set('updated_since', String((params as JsonRecord).updatedSince))
  }

  const url = `/api/clientes${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const fallbackData = !searchParams.toString() ? getBootstrapCollectionFromCache(cache, 'clientes') : undefined
  const { data, error, isLoading } = useSWR(url, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    fallbackData,
  })
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
  const { data, error, isLoading } = useSWR(key, fetcher, READ_ONLY_SWR_OPTIONS)
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
  const { cache } = useSWRConfig()
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.tipo) searchParams.set('tipo', params.tipo)
  if (params?.responsavel) searchParams.set('responsavel', params.responsavel)
  if (params?.clienteId) searchParams.set('cliente_id', params.clienteId)
  if ((params as JsonRecord | undefined)?.updatedSince) {
    searchParams.set('updated_since', String((params as JsonRecord).updatedSince))
  }

  const url = `/api/tarefas${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const fallbackData = !searchParams.toString() ? getBootstrapCollectionFromCache(cache, 'tarefas') : undefined
  const { data, error, isLoading } = useSWR(url, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    fallbackData,
  })
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
  const { cache } = useSWRConfig()
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.clienteId) searchParams.set('cliente_id', params.clienteId)
  if ((params as JsonRecord | undefined)?.updatedSince) {
    searchParams.set('updated_since', String((params as JsonRecord).updatedSince))
  }

  const url = `/api/propostas${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const fallbackData = !searchParams.toString() ? getBootstrapCollectionFromCache(cache, 'propostas') : undefined
  const { data, error, isLoading } = useSWR(url, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    fallbackData,
  })
  const propostas = useMemo(() => (data || []).map(normalizeProposta), [data])

  return {
    propostas,
    isLoading,
    error,
    mutate: () => mutate(url),
  }
}

export function useProposta(id: string | null) {
  const { cache } = useSWRConfig()
  const key = id ? `/api/propostas/${id}` : null
  const fallbackData = id ? getProposalSnapshotFromCache(cache, id) : undefined
  const { data, error, isLoading } = useSWR(key, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    fallbackData,
  })
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
  const { cache } = useSWRConfig()
  const searchParams = new URLSearchParams()
  if (params?.role) searchParams.set('role', params.role)
  if (params?.ativo) searchParams.set('ativo', params.ativo)

  const url = `/api/usuarios${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const fallbackData = !searchParams.toString() ? getBootstrapCollectionFromCache(cache, 'usuarios') : undefined
  const { data, error, isLoading } = useSWR(url, fetcher, {
    ...READ_ONLY_SWR_OPTIONS,
    fallbackData,
  })
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
  const { data, error, isLoading } = useSWR(key, fetcher, READ_ONLY_SWR_OPTIONS)
  const usuario = useMemo(() => (data ? normalizeUsuario(data) : undefined), [data])

  return {
    usuario,
    isLoading,
    error,
    mutate: () => (key ? mutate(key) : undefined),
  }
}

// Hook para Interacoes
export function useInteracoes(
  params?: string | null | { clienteId?: string | null; tipo?: TipoInteracao; limit?: number }
) {
  const resolvedParams =
    typeof params === 'string'
      ? { clienteId: params }
      : params === null
        ? { clienteId: null }
        : params === undefined
          ? { clienteId: undefined }
      : params

  const url = useMemo(() => {
    if (resolvedParams.clienteId === null) {
      return null
    }

    const searchParams = new URLSearchParams()
    if (resolvedParams.clienteId) searchParams.set('cliente_id', resolvedParams.clienteId)
    if (resolvedParams.tipo) searchParams.set('tipo', resolvedParams.tipo)
    if (resolvedParams.limit) searchParams.set('limit', String(resolvedParams.limit))

    return `/api/interacoes${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  }, [resolvedParams.clienteId, resolvedParams.limit, resolvedParams.tipo])

  const { data, error, isLoading } = useSWR(url, fetcher, READ_ONLY_SWR_OPTIONS)
  const interacoes = useMemo(() => (data || []).map(normalizeInteracao), [data])

  return {
    interacoes,
    isLoading,
    error,
    mutate: () => (url ? mutate(url) : undefined),
  }
}

export function useSession() {
  const { data, error, isLoading, mutate: localMutate } = useSWR(
    '/api/auth/session',
    fetcher,
    {
      ...READ_ONLY_SWR_OPTIONS,
      dedupingInterval: 120000,
    }
  )
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

export function useReadNotifications(enabled = true) {
  const key = enabled ? '/api/notificacoes/read' : null
  const { data, error, isLoading, mutate: localMutate } = useSWR(
    key,
    fetcher,
    {
      ...READ_ONLY_SWR_OPTIONS,
      dedupingInterval: 120000,
    }
  )

  return {
    readNotificationIds: Array.isArray(data) ? (data as string[]) : [],
    error,
    isLoading,
    mutate: localMutate,
  }
}

export function useRealtimeSync(enabled = true) {
  const lastVersionRef = useRef<number | null>(null)
  const lastModuleVersionsRef = useRef<Record<string, number>>({})
  const lastModuleChangedAtRef = useRef<Record<string, string>>({})
  const [isVisible, setIsVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const shouldPoll = enabled && isVisible && isOnline

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible')
    }

    const handleOnline = () => {
      setIsOnline(true)
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const { data } = useSWR(
    shouldPoll ? '/api/realtime/version' : null,
    fetcher,
    {
      ...READ_ONLY_SWR_OPTIONS,
      refreshInterval: 4000,
      revalidateOnFocus: false,
      dedupingInterval: 4000,
    }
  )

  useEffect(() => {
    const version = Number(data?.version || 0)
    const nextModuleVersions =
      data?.versions && typeof data.versions === 'object' ? (data.versions as Record<string, number>) : {}
    const nextModuleChangedAt =
      data?.changedAt && typeof data.changedAt === 'object' ? (data.changedAt as Record<string, string>) : {}
    if (!Number.isFinite(version)) {
      return
    }

    if (lastVersionRef.current === null) {
      lastVersionRef.current = version
      lastModuleVersionsRef.current = nextModuleVersions
      lastModuleChangedAtRef.current = nextModuleChangedAt
      return
    }

    if (version > lastVersionRef.current) {
      const changedModules = Object.entries(nextModuleVersions)
        .filter(([moduleName, moduleVersion]) => {
          const parsedVersion = Number(moduleVersion || 0)
          if (!Number.isFinite(parsedVersion)) {
            return false
          }

          const previousVersion = Number(lastModuleVersionsRef.current[moduleName] || 0)
          return parsedVersion > previousVersion
        })
        .map(([moduleName]) => moduleName)

      lastVersionRef.current = version
      lastModuleVersionsRef.current = nextModuleVersions
      const previousChangedAt = lastModuleChangedAtRef.current
      lastModuleChangedAtRef.current = nextModuleChangedAt
      if (changedModules.length > 0) {
        void Promise.all(
          changedModules.map((moduleName) =>
            syncIncrementalModule(moduleName, nextModuleChangedAt[moduleName], previousChangedAt[moduleName])
          )
        )
      } else {
        revalidateRealtimeData()
      }
      return
    }

    lastVersionRef.current = version
    lastModuleVersionsRef.current = nextModuleVersions
    lastModuleChangedAtRef.current = nextModuleChangedAt
  }, [data?.changedAt, data?.version, data?.versions])
}

// Funcoes de mutacao (CRUD)
export async function createCliente(data: Partial<Cliente> & JsonRecord) {
  const payload = {
    nome: data.nome,
    cpf: data.cpf || null,
    email: data.email || null,
    telefone: data.telefone || null,
    endereco: data.endereco || null,
    origem: data.origem || null,
    statusFunil: data.statusFunil || data.status || 'lead_novo',
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

  await prependBootstrapEntity('clientes', created as JsonRecord)
  await prependEntityToKey('/api/clientes', created as JsonRecord)
  await mutate(`/api/clientes/${(created as JsonRecord).id}`, created as JsonRecord, { revalidate: false })
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return created
}

export async function updateCliente(id: string, data: Partial<Cliente> & JsonRecord) {
  const payload = compactObject({
    nome: data.nome,
    cpf: data.cpf === undefined ? undefined : (data.cpf || null),
    email: data.email === undefined ? undefined : (data.email || null),
    telefone: data.telefone === undefined ? undefined : (data.telefone || null),
    endereco: data.endereco === undefined ? undefined : (data.endereco || null),
    origem: data.origem === undefined ? undefined : (data.origem || null),
    statusFunil: data.statusFunil ?? data.status,
    observacoes: data.observacoes === undefined ? undefined : (data.observacoes || null),
    empresa: data.empresa === undefined ? undefined : (data.empresa || null),
    cargo: data.cargo === undefined ? undefined : (data.cargo || null),
    cidade: data.cidade === undefined ? undefined : (data.cidade || null),
    estado: data.estado === undefined ? undefined : (data.estado || null),
    cep: data.cep === undefined ? undefined : (data.cep || null),
  })

  const optimisticPatch = compactObject({
    nome: payload.nome,
    cpf: payload.cpf,
    email: payload.email,
    telefone: payload.telefone,
    endereco: payload.endereco,
    origem: payload.origem,
    status: payload.statusFunil,
    status_funil: payload.statusFunil,
    observacoes: payload.observacoes,
    empresa: payload.empresa,
    cargo: payload.cargo,
    cidade: payload.cidade,
    estado: payload.estado,
    cep: payload.cep,
  })

  await patchBootstrapEntity('clientes', id, optimisticPatch)

  try {
    const updated = await requestJson(`/api/clientes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    await mutateEntityByPrefix('/api/clientes', id, updated as JsonRecord)
    await patchBootstrapEntity('clientes', id, updated as JsonRecord)
    await mutate(`/api/clientes/${id}`, updated as JsonRecord, { revalidate: false })
    mutate('/api/dashboard')
    mutateByPrefix('/api/interacoes')
    return updated
  } catch (error) {
    mutate(`/api/clientes/${id}`)
    mutateByPrefix('/api/crm/bootstrap')
    throw error
  }
}

export async function deleteCliente(id: string) {
  await removeBootstrapEntity('clientes', id)
  const deleted = await requestJson(`/api/clientes/${id}`, { method: 'DELETE' })
  await removeEntityFromPrefix('/api/clientes', id)
  await mutate(`/api/clientes/${id}`, undefined, { revalidate: false })
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

  await prependBootstrapEntity('tarefas', created as JsonRecord)
  await prependEntityToKey('/api/tarefas', created as JsonRecord)
  await mutate(`/api/tarefas/${(created as JsonRecord).id}`, created as JsonRecord, { revalidate: false })
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

  const optimisticPatch = compactObject({
    titulo: payload.titulo,
    descricao: payload.descricao,
    dataHora: payload.dataHora,
    data_hora: payload.dataHora,
    status: payload.status,
    clienteId: payload.clienteId,
    cliente_id: payload.clienteId,
    responsavelId: payload.responsavelId,
    responsavel_id: payload.responsavelId,
  })

  await mutateEntityByPrefix('/api/tarefas', id, optimisticPatch)
  await patchBootstrapEntity('tarefas', id, optimisticPatch)

  try {
    const updated = await requestJson(`/api/tarefas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    await mutateEntityByPrefix('/api/tarefas', id, updated as JsonRecord)
    await patchBootstrapEntity('tarefas', id, updated as JsonRecord)
    await mutate(`/api/tarefas/${id}`, updated as JsonRecord, { revalidate: false })
    mutate('/api/dashboard')
    mutateByPrefix('/api/interacoes')
    return updated
  } catch (error) {
    mutate(`/api/tarefas/${id}`)
    mutate('/api/crm/bootstrap')
    mutate('/api/dashboard')
    throw error
  }
}

export async function updateTarefaStatus(id: string, status: StatusTarefa) {
  await mutateEntityByPrefix('/api/tarefas', id, { status })
  await patchBootstrapEntity('tarefas', id, { status })

  try {
    const updated = await requestJson(`/api/tarefas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    await mutateEntityByPrefix('/api/tarefas', id, updated as JsonRecord)
    await patchBootstrapEntity('tarefas', id, updated as JsonRecord)
    await mutate(`/api/tarefas/${id}`, updated as JsonRecord, { revalidate: false })
    mutate('/api/dashboard')
    mutateByPrefix('/api/interacoes')
    return updated
  } catch (error) {
    mutate(`/api/tarefas/${id}`)
    mutate('/api/crm/bootstrap')
    mutate('/api/dashboard')
    throw error
  }
}

export async function deleteTarefa(id: string) {
  await removeBootstrapEntity('tarefas', id)
  const deleted = await requestJson(`/api/tarefas/${id}`, { method: 'DELETE' })
  await removeEntityFromPrefix('/api/tarefas', id)
  await mutate(`/api/tarefas/${id}`, undefined, { revalidate: false })
  mutate('/api/dashboard')
  return deleted
}

export async function createProposta(data: Partial<Proposta> & JsonRecord) {
  const parsedValor = parseNumberLike(data.valor)
  const parsedDesconto = parseNumberLike(data.desconto)
  const payload = {
    clienteId: data.clienteId,
    titulo: data.titulo || 'Proposta Comercial',
    descricao: data.descricao || '',
    valor: parsedValor ?? 0,
    desconto: parsedDesconto ?? 0,
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

  await prependBootstrapEntity('propostas', created as JsonRecord)
  await prependEntityToKey('/api/propostas', created as JsonRecord)
  mutate('/api/dashboard')
  mutateByPrefix('/api/interacoes')
  return created
}

export async function updateProposta(id: string, data: Partial<Proposta> & JsonRecord) {
  const parsedValor = parseNumberLike(data.valor)
  const parsedDesconto = parseNumberLike(data.desconto)
  const parsedClienteValorFechado = parseNumberLike(data.clienteValorFechado)
  const hasExplicitValor = hasFilledValue(data.valor)
  const hasExplicitDesconto = hasFilledValue(data.desconto)
  const payload = {
    titulo: data.titulo || 'Proposta Comercial',
    descricao: data.descricao || '',
    valor: hasExplicitValor ? (parsedValor ?? 0) : null,
    desconto: hasExplicitDesconto ? (parsedDesconto ?? 0) : null,
    status: mapPropostaStatusToApi(data.status),
    validade: data.validade || null,
    servicos: data.servicos || [],
    condicoes: data.condicoes || null,
    responsavelId: data.responsavelId || null,
    orcamentistaId: data.orcamentistaId || null,
    comentario: data.comentario || null,
    justificativa: data.justificativa || null,
    workflowAction: data.workflowAction || null,
    clienteId: data.clienteId || null,
    followUpTime: data.followUpTime || null,
    clienteNome: data.clienteNome || null,
    clienteCpf: data.clienteCpf || null,
    clienteTelefone: data.clienteTelefone || null,
    clienteEmail: data.clienteEmail || null,
    clienteEndereco: data.clienteEndereco || null,
    clienteValorFechado: parsedClienteValorFechado ?? null,
  }
  const anexos = Array.isArray(data.anexos)
    ? (data.anexos as unknown[]).filter((item): item is File => item instanceof File)
    : []
  const isMultipart = anexos.some((item) => item instanceof File)
  const body = isMultipart ? buildProposalFormData(payload, anexos) : JSON.stringify(payload)
  const optimisticStatus = mapPropostaStatusToApi(data.status)
  const optimisticPatch = compactObject({
    titulo: payload.titulo,
    descricao: payload.descricao,
    valor: payload.valor,
    desconto: payload.desconto,
    status: optimisticStatus,
    validade: payload.validade,
    clienteId: payload.clienteId,
    cliente_id: payload.clienteId,
    responsavelId: payload.responsavelId,
    responsavel_id: payload.responsavelId,
    orcamentistaId: payload.orcamentistaId,
    orcamentista_id: payload.orcamentistaId,
    followUpTime: payload.followUpTime,
    follow_up_time: payload.followUpTime,
  })

  await mutate(`/api/propostas/${id}`, (current) => updateCachedEntity(current, id, optimisticPatch), {
    revalidate: false,
  })
  await mutateEntityByPrefix('/api/propostas', id, optimisticPatch)
  await patchBootstrapEntity('propostas', id, optimisticPatch)

  try {
    const updated = await requestJson(`/api/propostas/${id}`, {
      method: 'PUT',
      ...(isMultipart ? {} : { headers: { 'Content-Type': 'application/json' } }),
      body,
    })

    await mutate(`/api/propostas/${id}`, updated as JsonRecord, { revalidate: false })
    await mutateEntityByPrefix('/api/propostas', id, updated as JsonRecord)
    await patchBootstrapEntity('propostas', id, updated as JsonRecord)
    mutateByPrefix('/api/tarefas')
    mutateByPrefix('/api/crm/bootstrap')
    mutate('/api/dashboard')
    mutateByPrefix('/api/interacoes')
    return updated
  } catch (error) {
    mutate(`/api/propostas/${id}`)
    mutateByPrefix('/api/propostas')
    mutateByPrefix('/api/tarefas')
    mutateByPrefix('/api/crm/bootstrap')
    mutate('/api/dashboard')
    throw error
  }
}

export async function updatePropostaStatus(id: string, status: StatusProposta) {
  return updateProposta(id, { status })
}

export async function deleteProposta(id: string) {
  await removeBootstrapEntity('propostas', id)
  const deleted = await requestJson(`/api/propostas/${id}`, { method: 'DELETE' })
  await removeEntityFromPrefix('/api/propostas', id)
  mutate('/api/dashboard')
  return deleted
}

export async function createUsuario(data: Partial<Usuario> & JsonRecord) {
  const created = await requestJson('/api/usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  await prependBootstrapEntity('usuarios', created as JsonRecord)
  await prependEntityToKey('/api/usuarios', created as JsonRecord)
  await mutate(`/api/usuarios/${(created as JsonRecord).id}`, created as JsonRecord, { revalidate: false })
  return created
}

export async function updateUsuario(id: string, data: Partial<Usuario> & JsonRecord) {
  await patchBootstrapEntity('usuarios', id, data)

  try {
    const updated = await requestJson(`/api/usuarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    await mutateEntityByPrefix('/api/usuarios', id, updated as JsonRecord)
    await patchBootstrapEntity('usuarios', id, updated as JsonRecord)
    await mutate(`/api/usuarios/${id}`, updated as JsonRecord, { revalidate: false })
    return updated
  } catch (error) {
    mutate(`/api/usuarios/${id}`)
    mutate('/api/crm/bootstrap')
    throw error
  }
}

export async function deleteUsuario(id: string) {
  await removeBootstrapEntity('usuarios', id)
  const deleted = await requestJson(`/api/usuarios/${id}`, { method: 'DELETE' })
  await removeEntityFromPrefix('/api/usuarios', id)
  await mutate(`/api/usuarios/${id}`, undefined, { revalidate: false })
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
