'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  CheckSquare,
  FileText,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  User,
  Users,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useInteracoes, useReadNotifications, useSession } from '@/lib/hooks/use-api'
import { statusPropostaLabels, type Interacao, type StatusProposta, type Tarefa } from '@/lib/data/types'

interface CRMHeaderProps {
  title: string
  subtitle?: string
  action?: {
    label: string
    onClick: () => void
  }
}

type NotificationGroupKey = 'clientes' | 'tarefas' | 'propostas'

type HeaderNotification = {
  id: string
  group: NotificationGroupKey
  title: string
  description: string
  href: string
  createdAt: number
  persistent: boolean
}

const GROUP_META: Record<
  NotificationGroupKey,
  { title: string; icon: typeof Users }
> = {
  clientes: { title: 'Clientes', icon: Users },
  tarefas: { title: 'Tarefas', icon: CheckSquare },
  propostas: { title: 'Propostas', icon: FileText },
}

function getReadStorageKey(userId?: string | null) {
  return `crm-read-notifications:${userId || 'anon'}`
}

function humanizeProposalStatus(status: unknown) {
  const normalized = String(status || '').trim() as StatusProposta
  if (normalized && normalized in statusPropostaLabels) {
    return statusPropostaLabels[normalized]
  }

  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatProposalNotificationDescription(interacao: Interacao) {
  const proposalNumberMatch = interacao.descricao.match(/Proposta\s+([A-Z0-9-]+)/i)
  const proposalNumber = proposalNumberMatch?.[1] || String(interacao.dados?.proposta_numero || '').trim()
  const statusLabel = humanizeProposalStatus(interacao.dados?.novo_status)

  if (proposalNumber && statusLabel) {
    return `${proposalNumber} agora está em ${statusLabel}`
  }

  if (proposalNumber) {
    return `A proposta ${proposalNumber} foi atualizada`
  }

  return interacao.descricao
}

export function CRMHeader({ title, subtitle, action }: CRMHeaderProps) {
  const router = useRouter()
  const { state } = useCRM()
  const { notifications } = useAppSettings()
  const { user } = useSession()
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false)
  const [shouldLoadProposalNotifications, setShouldLoadProposalNotifications] = useState(false)
  const {
    readNotificationIds,
    isLoading: isLoadingReadNotifications,
    mutate: mutateReadNotifications,
  } = useReadNotifications(Boolean(user?.id) && notifications.propostas && shouldLoadProposalNotifications)
  const { interacoes } = useInteracoes(
    notifications.propostas && user && shouldLoadProposalNotifications
      ? { tipo: 'proposta', limit: 12 }
      : null
  )
  const [commandOpen, setCommandOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const shownBrowserNotificationIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(getReadStorageKey(`${user?.id}:browser`))

    try {
      shownBrowserNotificationIds.current = new Set(saved ? JSON.parse(saved) : [])
    } catch {
      shownBrowserNotificationIds.current = new Set()
    }
  }, [user?.id])

  const readNotificationIdsSet = useMemo(() => new Set(readNotificationIds), [readNotificationIds])

  const allowedPropostaIds = useMemo(() => {
    if (user?.role === 'admin' || user?.role === 'gerente') {
      return new Set(state.propostas.map((proposta) => proposta.id))
    }

    return new Set(
      state.propostas
        .filter((proposta) => proposta.responsavelId === user?.id)
        .map((proposta) => proposta.id)
    )
  }, [state.propostas, user?.id, user?.role])

  const allowedClienteIds = useMemo(() => {
    if (user?.role === 'admin' || user?.role === 'gerente') {
      return new Set(state.clientes.map((cliente) => cliente.id))
    }

    const proposalClientIds = state.propostas
      .filter((proposta) => proposta.responsavelId === user?.id)
      .map((proposta) => proposta.clienteId)

    const directClientIds = state.clientes
      .filter((cliente) => cliente.responsavelId === user?.id)
      .map((cliente) => cliente.id)

    return new Set([...proposalClientIds, ...directClientIds])
  }, [state.clientes, state.propostas, user?.id, user?.role])

  const taskNotifications = useMemo<HeaderNotification[]>(() => {
    if (!notifications.tarefas) return []

    const now = Date.now()
    const tasks = state.tarefas
      .filter((tarefa) => tarefa.status === 'pendente')
      .filter((tarefa) => user?.role === 'admin' || tarefa.responsavelId === user?.id)
      .sort((a, b) => new Date(a.dataHora).getTime() - new Date(b.dataHora).getTime())

    return tasks.slice(0, 12).map((tarefa: Tarefa) => {
      const isLate = new Date(tarefa.dataHora).getTime() < now
      return {
        id: `task-${tarefa.id}`,
        group: 'tarefas',
        title: isLate ? 'Tarefa atrasada' : 'Tarefa pendente',
        description: tarefa.titulo || tarefa.descricao,
        href: '/tarefas',
        createdAt: new Date(tarefa.dataHora).getTime(),
        persistent: true,
      }
    })
  }, [notifications.tarefas, state.tarefas, user?.id, user?.role])

  const leadNotifications = useMemo<HeaderNotification[]>(() => {
    if (!notifications.novosLeads) return []

    const activeLeadStatuses = new Set(['lead_novo', 'em_atendimento', 'orcamento_enviado', 'negociacao'])
    const clientsWithPendingTask = new Set(
      state.tarefas
        .filter((tarefa) => tarefa.status === 'pendente')
        .map((tarefa) => tarefa.clienteId)
        .filter(Boolean)
    )

    return state.clientes
      .filter((cliente) => activeLeadStatuses.has(cliente.status))
      .filter((cliente) => user?.role === 'admin' || user?.role === 'gerente' || allowedClienteIds.has(cliente.id))
      .filter((cliente) => !clientsWithPendingTask.has(cliente.id))
      .sort((a, b) => b.ultimoContato.getTime() - a.ultimoContato.getTime())
      .slice(0, 12)
      .map((cliente) => ({
        id: `lead-${cliente.id}`,
        group: 'clientes' as const,
        title: 'Lead sem proxima acao',
        description: `${cliente.nome} esta sem tarefa pendente no momento`,
        href: `/clientes/${cliente.id}`,
        createdAt: cliente.ultimoContato.getTime(),
        persistent: true,
      }))
  }, [allowedClienteIds, notifications.novosLeads, state.clientes, state.tarefas, user?.role])

  const actionNotifications = useMemo<HeaderNotification[]>(() => {
    if (isLoadingReadNotifications) return []
    if (!notifications.propostas) return []

    return interacoes
      .filter((interacao: Interacao) => interacao.tipo === 'proposta')
      .filter((interacao: Interacao) => {
        if (interacao.dados?.silent_notification || interacao.tipo !== 'proposta') {
          return false
        }

        if (interacao.dados?.notification_kind !== 'proposal_status') {
          return false
        }

        const propostaId = String(interacao.dados?.proposta_id || '')
        return user?.role === 'admin' || allowedPropostaIds.has(propostaId)
      })
      .map((interacao: Interacao) => {
        return {
          id: `interaction-${interacao.id}`,
          group: 'propostas' as const,
          title: 'Atualizacao de status da proposta',
          description: formatProposalNotificationDescription(interacao),
          href: '/propostas',
          createdAt: new Date(interacao.criadoEm).getTime(),
          persistent: false,
        }
      })
      .filter((item: HeaderNotification) => !readNotificationIdsSet.has(item.id))
      .sort((a: HeaderNotification, b: HeaderNotification) => b.createdAt - a.createdAt)
      .slice(0, 20)
  }, [
    allowedPropostaIds,
    isLoadingReadNotifications,
    notifications.propostas,
    readNotificationIdsSet,
    interacoes,
    user?.role,
  ])

  const groupedNotifications = useMemo(() => {
    const groups: Record<NotificationGroupKey, HeaderNotification[]> = {
      clientes: [],
      tarefas: [],
      propostas: [],
    }

    actionNotifications.forEach((item) => {
      groups[item.group].push(item)
    })

    taskNotifications.forEach((item) => {
      groups.tarefas.push(item)
    })

    leadNotifications.forEach((item) => {
      groups.clientes.push(item)
    })

    return groups
  }, [actionNotifications, leadNotifications, taskNotifications])

  const notificationCount = Object.values(groupedNotifications).reduce(
    (acc, items) => acc + items.length,
    0
  )

  useEffect(() => {
    if (!notifications.propostas || !user?.id || shouldLoadProposalNotifications) {
      return
    }

    let timeoutId: number | null = null
    let idleId: number | null = null
    const requestIdle = window.requestIdleCallback?.bind(window)
    const cancelIdle = window.cancelIdleCallback?.bind(window)
    const enableNotifications = () => setShouldLoadProposalNotifications(true)

    if (requestIdle) {
      idleId = requestIdle(enableNotifications, { timeout: 2500 })
    } else {
      timeoutId = window.setTimeout(enableNotifications, 2500)
    }

    return () => {
      if (idleId !== null && cancelIdle) {
        cancelIdle(idleId)
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [notifications.propostas, shouldLoadProposalNotifications, user?.id])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const browserCandidates = [...actionNotifications, ...taskNotifications].filter(
      (item) => !shownBrowserNotificationIds.current.has(item.id)
    )

    browserCandidates.forEach((item) => {
      shownBrowserNotificationIds.current.add(item.id)
    })

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        getReadStorageKey(`${user?.id}:browser`),
        JSON.stringify([...shownBrowserNotificationIds.current])
      )
    }

    if (
      !notifications.browser ||
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return
    }

    browserCandidates.slice(0, 3).forEach((item) => {
      new Notification(item.title, { body: item.description })
    })
  }, [actionNotifications, notifications.browser, taskNotifications])

  const results = useMemo(() => {
    if (!commandOpen) return { clientes: [], tarefas: [], propostas: [] }

    const term = deferredQuery.trim().toLowerCase()
    if (!term) return { clientes: [], tarefas: [], propostas: [] }

    return {
      clientes: state.clientes.filter((cliente) =>
        [cliente.nome, cliente.email, cliente.telefone].some((value) =>
          value?.toLowerCase().includes(term)
        )
      ),
      tarefas: state.tarefas.filter((tarefa) =>
        [tarefa.titulo || '', tarefa.descricao].some((value) =>
          value.toLowerCase().includes(term)
        )
      ),
      propostas: state.propostas.filter((proposta) =>
        [proposta.titulo || '', proposta.descricao || ''].some((value) =>
          value.toLowerCase().includes(term)
        )
      ),
    }
  }, [commandOpen, deferredQuery, state.clientes, state.propostas, state.tarefas])

  const markNotificationAsRead = async (item: HeaderNotification) => {
    if (item.persistent) return
    await mutateReadNotifications(
      async (current: string[] | undefined) => {
        const nextIds = Array.isArray(current) ? current : []
        const mergedIds = nextIds.includes(item.id) ? nextIds : [...nextIds, item.id]
        void fetch('/api/notificacoes/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationIds: [item.id] }),
        })
        return mergedIds
      },
      { revalidate: false }
    )
  }

  const markAllActionNotificationsAsRead = async () => {
    if (actionNotifications.length === 0) return
    const ids = actionNotifications.map((item) => item.id)
    await mutateReadNotifications(
      async (current: string[] | undefined) => {
        const nextIds = Array.isArray(current) ? current : []
        const mergedIds = [...new Set([...nextIds, ...ids])]
        void fetch('/api/notificacoes/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationIds: ids }),
        })
        return mergedIds
      },
      { revalidate: false }
    )
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-card px-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes, tarefas e propostas..."
              className="w-72 cursor-pointer border-border bg-secondary pl-9 pr-16"
              onFocus={() => setCommandOpen(true)}
              readOnly
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Ctrl K
            </span>
          </div>

          {action && (
            <Button onClick={action.onClick} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {action.label}
            </Button>
          )}

          <DropdownMenu
            open={notificationMenuOpen}
            onOpenChange={(open) => {
              setNotificationMenuOpen(open)
              if (open) {
                setShouldLoadProposalNotifications(true)
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {notificationCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                    {notificationCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-96">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notificacoes</span>
                {actionNotifications.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => void markAllActionNotificationsAsRead()}
                  >
                    Marcar avisos como lidos
                  </Button>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {(['tarefas', 'propostas', 'clientes'] as NotificationGroupKey[]).map((group) => {
                const items = groupedNotifications[group]
                if (items.length === 0) return null

                const Icon = GROUP_META[group].icon

                return (
                  <div key={group}>
                    <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      {GROUP_META[group].title}
                    </DropdownMenuLabel>
                    {items.slice(0, 5).map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => {
                          void markNotificationAsRead(item)
                          router.push(item.href)
                        }}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{item.title}</span>
                          <span className="text-xs text-muted-foreground">{item.description}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </div>
                )
              })}

              {notificationCount === 0 && (
                <DropdownMenuItem disabled>Nenhuma notificacao no momento</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                    {user?.avatar || '??'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium md:inline">{user?.nome}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/perfil">
                  <User className="mr-2 h-4 w-4" />
                  Perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/configuracoes">
                  <Settings className="mr-2 h-4 w-4" />
                  Configuracoes
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => void handleLogout()}>
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="Busca global"
        description="Busque clientes, tarefas e propostas"
      >
        <CommandInput
          placeholder="Digite para buscar..."
          value={query}
          onValueChange={(value) => {
            startTransition(() => setQuery(value))
          }}
        />
        <CommandList>
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

          <CommandGroup heading="Clientes">
            {results.clientes.slice(0, 6).map((cliente) => (
              <CommandItem
                key={cliente.id}
                onSelect={() => {
                  setCommandOpen(false)
                  router.push(`/clientes/${cliente.id}`)
                }}
              >
                <Users className="h-4 w-4" />
                <span>{cliente.nome}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Tarefas">
            {results.tarefas.slice(0, 6).map((tarefa) => (
              <CommandItem
                key={tarefa.id}
                onSelect={() => {
                  setCommandOpen(false)
                  router.push('/tarefas')
                }}
              >
                <CheckSquare className="h-4 w-4" />
                <span>{tarefa.titulo || tarefa.descricao}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Propostas">
            {results.propostas.slice(0, 6).map((proposta) => (
              <CommandItem
                key={proposta.id}
                onSelect={() => {
                  setCommandOpen(false)
                  router.push('/propostas')
                }}
              >
                <FileText className="h-4 w-4" />
                <span>{proposta.titulo || proposta.descricao}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
