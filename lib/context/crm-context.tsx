'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
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
  useCrmBootstrap,
  useRealtimeSync,
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

interface CRMLookups {
  clientesById: Map<string, Cliente>
  usuariosById: Map<string, Usuario>
  interacoesByClienteId: Map<string, Interacao[]>
  tarefasByClienteId: Map<string, Tarefa[]>
  propostasByClienteId: Map<string, Proposta[]>
}

interface CRMContextType {
  state: CRMState
  lookups: CRMLookups
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
  useRealtimeSync(true)
  const { clientes, usuarios, tarefas, propostas } = useCrmBootstrap()
  const interacoes: Interacao[] = []

  const state = useMemo<CRMState>(
    () => ({
      clientes,
      usuarios,
      interacoes,
      tarefas,
      propostas,
    }),
    [clientes, interacoes, propostas, tarefas, usuarios]
  )

  const lookups = useMemo<CRMLookups>(() => {
    const clientesById = new Map<string, Cliente>()
    const usuariosById = new Map<string, Usuario>()
    const interacoesByClienteId = new Map<string, Interacao[]>()
    const tarefasByClienteId = new Map<string, Tarefa[]>()
    const propostasByClienteId = new Map<string, Proposta[]>()

    for (const cliente of clientes) {
      clientesById.set(cliente.id, cliente)
    }

    for (const usuario of usuarios) {
      usuariosById.set(usuario.id, usuario)
    }

    for (const interacao of interacoes) {
      const grouped = interacoesByClienteId.get(interacao.clienteId) || []
      grouped.push(interacao)
      interacoesByClienteId.set(interacao.clienteId, grouped)
    }

    for (const tarefa of tarefas) {
      const grouped = tarefasByClienteId.get(tarefa.clienteId) || []
      grouped.push(tarefa)
      tarefasByClienteId.set(tarefa.clienteId, grouped)
    }

    for (const proposta of propostas) {
      const grouped = propostasByClienteId.get(proposta.clienteId) || []
      grouped.push(proposta)
      propostasByClienteId.set(proposta.clienteId, grouped)
    }

    for (const [clienteId, grouped] of interacoesByClienteId.entries()) {
      interacoesByClienteId.set(
        clienteId,
        [...grouped].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      )
    }

    return {
      clientesById,
      usuariosById,
      interacoesByClienteId,
      tarefasByClienteId,
      propostasByClienteId,
    }
  }, [clientes, interacoes, propostas, tarefas, usuarios])

  const getCliente = (id: string) => lookups.clientesById.get(id)
  const getUsuario = (id: string) => lookups.usuariosById.get(id)

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
    lookups.interacoesByClienteId.get(clienteId) || []

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
    lookups.tarefasByClienteId.get(clienteId) || []

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
    lookups.propostasByClienteId.get(clienteId) || []

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

  const value = useMemo<CRMContextType>(
    () => ({
      state,
      lookups,
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
    }),
    [
      addCliente,
      addInteracao,
      addProposta,
      addTarefa,
      addUsuario,
      deleteCliente,
      deleteProposta,
      deleteTarefa,
      deleteUsuario,
      general.confirmDeletes,
      getClientesSemTarefa,
      getCliente,
      getInteracoesByCliente,
      getPropostasByCliente,
      getPropostasEmAberto,
      getTarefasAtrasadas,
      getTarefasByCliente,
      getTarefasHoje,
      getUsuario,
      lookups,
      state,
      updateCliente,
      updateProposta,
      updatePropostaStatus,
      updateTarefa,
      updateTarefaStatus,
      updateUsuario,
    ]
  )

  return (
    <CRMContext.Provider
      value={value}
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
