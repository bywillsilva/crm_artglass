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

// Role de usuario
export type RoleUsuario = 'admin' | 'gerente' | 'vendedor' | 'orcamentista'
export type ModuleKey =
  | 'dashboard'
  | 'clientes'
  | 'funil'
  | 'propostas'
  | 'tarefas'
  | 'relatorios'
  | 'performance'
  | 'usuarios'
export type ModulePermissions = Record<ModuleKey, boolean>

// Interface do Cliente
export interface Cliente {
  id: string
  nome: string
  cpf?: string
  telefone: string
  email: string
  empresa?: string
  cargo?: string
  endereco: string
  tipo: TipoCliente
  origem?: string
  observacoes: string
  status: StatusFunil
  responsavelId?: string
  valorEstimado: number
  ultimoContato: Date
  criadoEm: Date
}

export interface PropostaAnexo {
  id: string
  nome: string
  url: string
  tipoMime: string
  tamanho: number
  usuarioId?: string
  criadoEm: Date
}

export interface PropostaComentario {
  id: string
  propostaId: string
  usuarioId: string
  usuarioNome?: string
  comentario: string
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
  propostaId?: string
  automacaoEtapa?: string | null
  origem?: string
  criadoEm: Date
}

// Interface de Proposta
export interface Proposta {
  id: string
  clienteId: string
  clienteNome?: string
  numero?: string
  titulo?: string
  valor: number
  descricao?: string
  status: StatusProposta
  responsavelId?: string
  responsavelNome?: string
  orcamentistaId?: string
  orcamentistaNome?: string
  retificacoesCount?: number
  anexosCount?: number
  comentariosCount?: number
  anexos?: PropostaAnexo[]
  comentarios?: PropostaComentario[]
  followUpBaseAt?: Date | null
  followUpTime?: string | null
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
  modulePermissions?: Partial<ModulePermissions>
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
  novo_cliente: 'Novo Cliente',
  em_orcamento: 'Em Orcamento',
  aguardando_aprovacao: 'Orcamento Pronto Aguardando Aprovacao',
  enviar_ao_cliente: 'Enviar ao Cliente',
  enviado_ao_cliente: 'Enviado ao Cliente',
  follow_up_1_dia: 'Follow-up 1 Dia',
  aguardando_follow_up_3_dias: 'Aguardando Follow-up 3 Dias',
  follow_up_3_dias: 'Follow-up 3 Dias',
  aguardando_follow_up_7_dias: 'Aguardando Follow-up 7 Dias',
  follow_up_7_dias: 'Follow-up 7 Dias',
  stand_by: 'Stand-by',
  em_retificacao: 'Em Retificacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

export const statusPropostaColors: Record<StatusProposta, string> = {
  novo_cliente: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  em_orcamento: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  aguardando_aprovacao: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  enviar_ao_cliente: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  enviado_ao_cliente: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  follow_up_1_dia: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  aguardando_follow_up_3_dias: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  follow_up_3_dias: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  aguardando_follow_up_7_dias: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  follow_up_7_dias: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  stand_by: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
  em_retificacao: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  fechado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  perdido: 'bg-red-500/20 text-red-400 border-red-500/30',
}

// Labels para roles
export const roleLabels: Record<RoleUsuario, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  orcamentista: 'Orcamentista',
}
