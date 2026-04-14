'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  createCliente,
  createInteracao,
  createProposta,
  createTarefa,
  createUsuario,
  deleteCliente as deleteClienteRequest,
  deleteProposta as deletePropostaRequest,
  deleteTarefa as deleteTarefaRequest,
  deleteUsuario as deleteUsuarioRequest,
  updateCliente as updateClienteRequest,
  updateProposta as updatePropostaRequest,
  updatePropostaStatus as updatePropostaStatusRequest,
  updateTarefa as updateTarefaRequest,
  updateTarefaStatus as updateTarefaStatusRequest,
  updateUsuario as updateUsuarioRequest,
  useClientes,
  useInteracoes,
  usePropostas,
  useTarefas,
  useUsuarios,
} from '@/lib/hooks/use-api'
import { useAppSettings } from '@/lib/context/app-settings-context'
import type {
  Cliente,
  Interacao,
  Proposta,
  StatusProposta,
  StatusTarefa,
  Tarefa,
  Usuario,
} from '@/lib/data/types'

interface CRMState {
  clientes: Cliente[]
  usuarios: Usuario[]
  interacoes: Interacao[]
  tarefas: Tarefa[]
  propostas: Proposta[]
}

interface CRMContextType {
  state: CRMState
  addCliente: (cliente: Omit<Cliente, 'id' | 'criadoEm'>) => Promise<void>
  updateCliente: (cliente: Cliente) => Promise<void>
  deleteCliente: (id: string) => Promise<void>
  getCliente: (id: string) => Cliente | undefined
  addInteracao: (interacao: Omit<Interacao, 'id' | 'criadoEm'>) => Promise<void>
  getInteracoesByCliente: (clienteId: string) => Interacao[]
  addTarefa: (tarefa: Omit<Tarefa, 'id' | 'criadoEm'>) => Promise<void>
  updateTarefa: (tarefa: Tarefa) => Promise<void>
  deleteTarefa: (id: string) => Promise<void>
  updateTarefaStatus: (id: string, status: StatusTarefa) => Promise<void>
  getTarefasByCliente: (clienteId: string) => Tarefa[]
  getTarefasHoje: () => Tarefa[]
  getTarefasAtrasadas: () => Tarefa[]
  addProposta: (proposta: Omit<Proposta, 'id' | 'criadoEm'>) => Promise<void>
  updateProposta: (proposta: Proposta) => Promise<void>
  deleteProposta: (id: string) => Promise<void>
  updatePropostaStatus: (id: string, status: StatusProposta) => Promise<void>
  getPropostasByCliente: (clienteId: string) => Proposta[]
  addUsuario: (usuario: Omit<Usuario, 'id'> & { senha: string }) => Promise<void>
  updateUsuario: (usuario: Usuario) => Promise<void>
  deleteUsuario: (id: string) => Promise<void>
  getUsuario: (id: string) => Usuario | undefined
  getClientesSemTarefa: () => Cliente[]
  getPropostasEmAberto: () => Proposta[]
}

const CRMContext = createContext<CRMContextType | null>(null)

export function CRMProvider({ children }: { children: ReactNode }) {
  const { general } = useAppSettings()
  const { clientes } = useClientes()
  const { usuarios } = useUsuarios()
  const { interacoes } = useInteracoes()
  const { tarefas } = useTarefas()
  const { propostas } = usePropostas()

  const state: CRMState = {
    clientes,
    usuarios,
    interacoes,
    tarefas,
    propostas,
  }

  const getCliente = (id: string) => state.clientes.find((cliente) => cliente.id === id)
  const getUsuario = (id: string) => state.usuarios.find((usuario) => usuario.id === id)

  const addCliente = async (cliente: Omit<Cliente, 'id' | 'criadoEm'>) => {
    await createCliente(cliente)
  }

  const updateCliente = async (cliente: Cliente) => {
    await updateClienteRequest(cliente.id, cliente)
  }

  const deleteCliente = async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir este cliente?')
      if (!confirmed) return
    }
    await deleteClienteRequest(id)
  }

  const addInteracao = async (interacao: Omit<Interacao, 'id' | 'criadoEm'>) => {
    await createInteracao(interacao)
  }

  const getInteracoesByCliente = (clienteId: string) =>
    state.interacoes
      .filter((interacao) => interacao.clienteId === clienteId)
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())

  const addTarefa = async (tarefa: Omit<Tarefa, 'id' | 'criadoEm'>) => {
    await createTarefa(tarefa)
  }

  const updateTarefa = async (tarefa: Tarefa) => {
    await updateTarefaRequest(tarefa.id, tarefa)
  }

  const deleteTarefa = async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir esta tarefa?')
      if (!confirmed) return
    }
    await deleteTarefaRequest(id)
  }

  const updateTarefaStatus = async (id: string, status: StatusTarefa) => {
    await updateTarefaStatusRequest(id, status)
  }

  const getTarefasByCliente = (clienteId: string) =>
    state.tarefas.filter((tarefa) => tarefa.clienteId === clienteId)

  const getTarefasHoje = () => {
    const hoje = new Date()
    return state.tarefas.filter((tarefa) => {
      const dataHora = new Date(tarefa.dataHora)
      return (
        dataHora.getFullYear() === hoje.getFullYear() &&
        dataHora.getMonth() === hoje.getMonth() &&
        dataHora.getDate() === hoje.getDate() &&
        tarefa.status !== 'concluida'
      )
    })
  }

  const getTarefasAtrasadas = () =>
    state.tarefas.filter((tarefa) => {
      const dataHora = new Date(tarefa.dataHora)
      return dataHora < new Date() && tarefa.status === 'pendente'
    })

  const addProposta = async (proposta: Omit<Proposta, 'id' | 'criadoEm'>) => {
    await createProposta({
      ...proposta,
      titulo: proposta.titulo || 'Proposta Comercial',
    })
  }

  const updateProposta = async (proposta: Proposta) => {
    await updatePropostaRequest(proposta.id, proposta)
  }

  const deleteProposta = async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir esta proposta?')
      if (!confirmed) return
    }
    await deletePropostaRequest(id)
  }

  const updatePropostaStatus = async (id: string, status: StatusProposta) => {
    await updatePropostaStatusRequest(id, status)
  }

  const getPropostasByCliente = (clienteId: string) =>
    state.propostas.filter((proposta) => proposta.clienteId === clienteId)

  const addUsuario = async (usuario: Omit<Usuario, 'id'> & { senha: string }) => {
    await createUsuario(usuario)
  }

  const updateUsuario = async (usuario: Usuario) => {
    await updateUsuarioRequest(usuario.id, usuario)
  }

  const deleteUsuario = async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir este usuario?')
      if (!confirmed) return
    }
    await deleteUsuarioRequest(id)
  }

  const getClientesSemTarefa = () => {
    const clientesComTarefa = new Set(
      state.tarefas
        .filter((tarefa) => tarefa.status !== 'concluida')
        .map((tarefa) => tarefa.clienteId)
    )

    return state.clientes.filter((cliente) => !clientesComTarefa.has(cliente.id))
  }

  const getPropostasEmAberto = () =>
    state.propostas.filter((proposta) =>
      [
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
      ].includes(proposta.status)
    )

  return (
    <CRMContext.Provider
      value={{
        state,
        addCliente,
        updateCliente,
        deleteCliente,
        getCliente,
        addInteracao,
        getInteracoesByCliente,
        addTarefa,
        updateTarefa,
        deleteTarefa,
        updateTarefaStatus,
        getTarefasByCliente,
        getTarefasHoje,
        getTarefasAtrasadas,
        addProposta,
        updateProposta,
        deleteProposta,
        updatePropostaStatus,
        getPropostasByCliente,
        addUsuario,
        updateUsuario,
        deleteUsuario,
        getUsuario,
        getClientesSemTarefa,
        getPropostasEmAberto,
      }}
    >
      {children}
    </CRMContext.Provider>
  )
}

export function useCRM() {
  const context = useContext(CRMContext)
  if (!context) {
    throw new Error('useCRM deve ser usado dentro de um CRMProvider')
  }
  return context
}
