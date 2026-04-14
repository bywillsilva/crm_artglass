// Status do funil de vendas
export type StatusFunil =
  | 'lead_novo'
  | 'em_atendimento'
  | 'orcamento_enviado'
  | 'negociacao'
  | 'fechado'
  | 'perdido'

// Tipo de cliente
export type TipoCliente = 'residencial' | 'comercial'

// Tipo de interacao
export type TipoInteracao =
  | 'ligacao'
  | 'reuniao'
  | 'visita'
  | 'email'
  | 'nota'
  | 'mudanca_status'
  | 'proposta'
  | 'tarefa'

// Status de tarefa
export type StatusTarefa = 'pendente' | 'concluida' | 'atrasada'

// Status de proposta
export type StatusProposta =
  | 'em_cotacao'
  | 'enviado_ao_cliente'
  | 'em_negociacao'
  | 'em_retificacao'
  | 'fechado'
  | 'perdido'

// Role de usuario
export type RoleUsuario = 'admin' | 'gerente' | 'vendedor'

// Interface do Cliente
export interface Cliente {
  id: string
  nome: string
  telefone: string
  email: string
  empresa?: string
  cargo?: string
  endereco: string
  tipo: TipoCliente
  origem: string
  observacoes: string
  status: StatusFunil
  responsavelId?: string
  valorEstimado: number
  ultimoContato: Date
  criadoEm: Date
}

// Interface de Interacao
export interface Interacao {
  id: string
  clienteId: string
  tipo: TipoInteracao
  descricao: string
  usuarioId: string
  dados?: Record<string, unknown> | null
  criadoEm: Date
}

// Interface de Tarefa
export interface Tarefa {
  id: string
  clienteId: string
  titulo?: string
  descricao: string
  dataHora: Date
  status: StatusTarefa
  tipo?: string
  responsavelId: string
  criadoEm: Date
}

// Interface de Proposta
export interface Proposta {
  id: string
  clienteId: string
  titulo?: string
  valor: number
  descricao: string
  status: StatusProposta
  responsavelId?: string
  dataEnvio: Date
  criadoEm: Date
}

// Interface de Usuario
export interface Usuario {
  id: string
  nome: string
  email: string
  avatar: string
  role: RoleUsuario
  ativo: boolean
  metaVendas?: number
}

// Labels para o funil
export const statusFunilLabels: Record<StatusFunil, string> = {
  lead_novo: 'Lead Novo',
  em_atendimento: 'Em Atendimento',
  orcamento_enviado: 'Orcamento Enviado',
  negociacao: 'Negociacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

// Cores para status do funil
export const statusFunilColors: Record<StatusFunil, string> = {
  lead_novo: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  em_atendimento: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  orcamento_enviado: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  negociacao: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  fechado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  perdido: 'bg-red-500/20 text-red-400 border-red-500/30',
}

// Labels para tipo de interacao
export const tipoInteracaoLabels: Record<TipoInteracao, string> = {
  ligacao: 'Ligacao',
  reuniao: 'Reuniao',
  visita: 'Visita',
  email: 'E-mail',
  nota: 'Nota',
  mudanca_status: 'Mudanca de Status',
  proposta: 'Proposta',
  tarefa: 'Tarefa',
}

// Labels para status de tarefa
export const statusTarefaLabels: Record<StatusTarefa, string> = {
  pendente: 'Pendente',
  concluida: 'Concluida',
  atrasada: 'Atrasada',
}

// Labels para status de proposta
export const statusPropostaLabels: Record<StatusProposta, string> = {
  em_cotacao: 'Em Cotacao',
  enviado_ao_cliente: 'Enviado ao Cliente',
  em_negociacao: 'Em Negociacao',
  em_retificacao: 'Em Retificacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

export const statusPropostaColors: Record<StatusProposta, string> = {
  em_cotacao: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  enviado_ao_cliente: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  em_negociacao: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  em_retificacao: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  fechado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  perdido: 'bg-red-500/20 text-red-400 border-red-500/30',
}

// Labels para roles
export const roleLabels: Record<RoleUsuario, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
}
