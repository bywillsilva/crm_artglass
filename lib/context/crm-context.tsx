'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
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
  const pathname = usePathname()
  useRealtimeSync(true)
  const bootstrapSections = useMemo(() => {
    const isClienteDetailsPage = /^\/clientes\/[^/]+/.test(pathname)

    if (isClienteDetailsPage) return ['clientes', 'usuarios', 'tarefas', 'propostas'] as const
    if (pathname.startsWith('/clientes')) return ['clientes', 'usuarios'] as const
    if (pathname.startsWith('/funil')) return ['propostas', 'usuarios'] as const
    if (pathname.startsWith('/propostas')) return ['propostas', 'clientes', 'usuarios'] as const
    if (pathname.startsWith('/tarefas')) return ['tarefas', 'clientes', 'usuarios'] as const
    if (pathname.startsWith('/usuarios')) return ['usuarios'] as const
    if (pathname.startsWith('/relatorios/vendedores')) return ['propostas', 'usuarios'] as const
    if (pathname.startsWith('/relatorios')) return ['clientes', 'propostas', 'usuarios'] as const
    return ['usuarios'] as const
  }, [pathname])
  const { clientes, usuarios, tarefas, propostas } = useCrmBootstrap([...bootstrapSections])
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
      const relatedClienteIds = new Set<string>()

      if (tarefa.clienteId) {
        relatedClienteIds.add(tarefa.clienteId)
      }

      if (tarefa.propostaId) {
        const proposalClientId = propostas.find((proposta: Proposta) => proposta.id === tarefa.propostaId)?.clienteId
        if (proposalClientId) {
          relatedClienteIds.add(proposalClientId)
        }
      }

      for (const relatedClienteId of relatedClienteIds) {
        const grouped = tarefasByClienteId.get(relatedClienteId) || []
        grouped.push(tarefa)
        tarefasByClienteId.set(relatedClienteId, grouped)
      }
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

  const getCliente = useCallback((id: string) => lookups.clientesById.get(id), [lookups.clientesById])
  const getUsuario = useCallback((id: string) => lookups.usuariosById.get(id), [lookups.usuariosById])

  const addCliente = useCallback(async (cliente: Omit<Cliente, 'id' | 'criadoEm'>) => {
    await createCliente(cliente)
  }, [])

  const updateCliente = useCallback(async (cliente: Cliente) => {
    await updateClienteRequest(cliente.id, cliente)
  }, [])

  const deleteCliente = useCallback(async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir este cliente?')
      if (!confirmed) return
    }
    await deleteClienteRequest(id)
  }, [general.confirmDeletes])

  const addInteracao = useCallback(async (interacao: Omit<Interacao, 'id' | 'criadoEm'>) => {
    await createInteracao(interacao)
  }, [])

  const getInteracoesByCliente = useCallback(
    (clienteId: string) => lookups.interacoesByClienteId.get(clienteId) || [],
    [lookups.interacoesByClienteId]
  )

  const addTarefa = useCallback(async (tarefa: Omit<Tarefa, 'id' | 'criadoEm'>) => {
    await createTarefa(tarefa)
  }, [])

  const updateTarefa = useCallback(async (tarefa: Tarefa) => {
    await updateTarefaRequest(tarefa.id, tarefa)
  }, [])

  const deleteTarefa = useCallback(async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir esta tarefa?')
      if (!confirmed) return
    }
    await deleteTarefaRequest(id)
  }, [general.confirmDeletes])

  const updateTarefaStatus = useCallback(async (id: string, status: StatusTarefa) => {
    await updateTarefaStatusRequest(id, status)
  }, [])

  const getTarefasByCliente = useCallback(
    (clienteId: string) => lookups.tarefasByClienteId.get(clienteId) || [],
    [lookups.tarefasByClienteId]
  )

  const getTarefasHoje = useCallback(() => {
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
  }, [state.tarefas])

  const getTarefasAtrasadas = useCallback(
    () =>
      state.tarefas.filter((tarefa) => {
      const dataHora = new Date(tarefa.dataHora)
      return dataHora < new Date() && tarefa.status === 'pendente'
      }),
    [state.tarefas]
  )

  const addProposta = useCallback(async (proposta: Omit<Proposta, 'id' | 'criadoEm'>) => {
    await createProposta({
      ...proposta,
      titulo: proposta.titulo || 'Proposta Comercial',
    })
  }, [])

  const updateProposta = useCallback(async (proposta: Proposta) => {
    await updatePropostaRequest(proposta.id, proposta)
  }, [])

  const deleteProposta = useCallback(async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir esta proposta?')
      if (!confirmed) return
    }
    await deletePropostaRequest(id)
  }, [general.confirmDeletes])

  const updatePropostaStatus = useCallback(async (id: string, status: StatusProposta) => {
    await updatePropostaStatusRequest(id, status)
  }, [])

  const getPropostasByCliente = useCallback(
    (clienteId: string) => lookups.propostasByClienteId.get(clienteId) || [],
    [lookups.propostasByClienteId]
  )

  const addUsuario = useCallback(async (usuario: Omit<Usuario, 'id'> & { senha: string }) => {
    await createUsuario(usuario)
  }, [])

  const updateUsuario = useCallback(async (usuario: Usuario) => {
    await updateUsuarioRequest(usuario.id, usuario)
  }, [])

  const deleteUsuario = useCallback(async (id: string) => {
    if (general.confirmDeletes && typeof window !== 'undefined') {
      const confirmed = window.confirm('Tem certeza que deseja excluir este usuario?')
      if (!confirmed) return
    }
    await deleteUsuarioRequest(id)
  }, [general.confirmDeletes])

  const getClientesSemTarefa = useCallback(() => {
    const clientesComTarefa = new Set(
      state.tarefas
        .filter((tarefa) => tarefa.status !== 'concluida')
        .map((tarefa) => tarefa.clienteId)
    )

    return state.clientes.filter((cliente) => !clientesComTarefa.has(cliente.id))
  }, [state.clientes, state.tarefas])

  const getPropostasEmAberto = useCallback(
    () =>
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
      ),
    [state.propostas]
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
