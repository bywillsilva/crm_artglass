import type { Cliente, Usuario, Interacao, Tarefa, Proposta } from './types'

// Usuários mockados
export const usuariosIniciais: Usuario[] = [
  {
    id: 'user-1',
    nome: 'Carlos Silva',
    email: 'carlos@solartech.com',
    avatar: 'CS',
    role: 'admin',
    ativo: true,
  },
]

// Clientes mockados
export const clientesIniciais: Cliente[] = [
  {
    id: 'client-1',
    nome: 'Willian Raniere',
    telefone: '(11) 99999-1234',
    email: 'roberto@email.com',
    endereco: 'Rua das Flores, 123 - São Paulo, SP',
    tipo: 'residencial',
    origem: 'Google Ads',
    observacoes: 'Cliente interessado em sistema de 5kWp',
    status: 'lead_novo',
    responsavelId: 'user-3',
    ultimoContato: new Date('2026-03-18'),
    criadoEm: new Date('2026-03-15'),
  },
]

// Interações mockadas
export const interacoesIniciais: Interacao[] = [
  {
    id: 'inter-1',
    clienteId: 'client-1',
    tipo: 'ligacao',
    descricao: 'Primeiro contato, cliente solicitou informações sobre energia solar',
    usuarioId: 'user-3',
    criadoEm: new Date('2026-03-15'),
  },
]

// Tarefas mockadas
export const tarefasIniciais: Tarefa[] = [
  {
    id: 'task-1',
    clienteId: 'client-1',
    descricao: 'Ligar para agendar visita técnica',
    dataHora: new Date('2026-03-19T10:00:00'),
    status: 'pendente',
    responsavelId: 'user-3',
    criadoEm: new Date('2026-03-15'),
  },
]

// Propostas mockadas
export const propostasIniciais: Proposta[] = [
  {
    id: 'prop-1',
    clienteId: 'client-3',
    valor: 32000,
    descricao: 'Sistema fotovoltaico 5kWp - Residencial',
    status: 'em_orcamento',
    dataEnvio: new Date('2026-03-16'),
    criadoEm: new Date('2026-03-16'),
  },
]
