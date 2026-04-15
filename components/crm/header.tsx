'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useInteracoes, useSession } from '@/lib/hooks/use-api'
import type { Interacao, Tarefa } from '@/lib/data/types'

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

export function CRMHeader({ title, subtitle, action }: CRMHeaderProps) {
  const router = useRouter()
  const { state } = useCRM()
  const { notifications } = useAppSettings()
  const { user } = useSession()
  const { interacoes } = useInteracoes({ tipo: 'proposta', limit: 200 })
  const [commandOpen, setCommandOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [loadedReadNotifications, setLoadedReadNotifications] = useState(false)
  const shownBrowserNotificationIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let isMounted = true

    const loadReadNotifications = async () => {
      if (!user?.id) return

      try {
        const response = await fetch('/api/notificacoes/read')
        const data = await response.json()
        if (response.ok && isMounted) {
          setReadNotificationIds(Array.isArray(data) ? data : [])
          setLoadedReadNotifications(true)
        }
      } catch {
        if (isMounted) {
          setReadNotificationIds([])
          setLoadedReadNotifications(true)
        }
      }
    }

    void loadReadNotifications()

    return () => {
      isMounted = false
    }
  }, [user?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(getReadStorageKey(`${user?.id}:browser`))
    shownBrowserNotificationIds.current = new Set(saved ? JSON.parse(saved) : [])
  }, [user?.id])

  const allowedPropostaIds = useMemo(() => {
    if (user?.role === 'admin') {
      return new Set(state.propostas.map((proposta) => proposta.id))
    }

    return new Set(
      state.propostas
        .filter((proposta) => proposta.responsavelId === user?.id)
        .map((proposta) => proposta.id)
    )
  }, [state.propostas, user?.id, user?.role])

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

  const actionNotifications = useMemo<HeaderNotification[]>(() => {
    if (!loadedReadNotifications) return []
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
          description: interacao.descricao,
          href: '/propostas',
          createdAt: new Date(interacao.criadoEm).getTime(),
          persistent: false,
        }
      })
      .filter((item: HeaderNotification) => !readNotificationIds.includes(item.id))
      .sort((a: HeaderNotification, b: HeaderNotification) => b.createdAt - a.createdAt)
      .slice(0, 20)
  }, [
    allowedPropostaIds,
    loadedReadNotifications,
    notifications.propostas,
    readNotificationIds,
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

    return groups
  }, [actionNotifications, taskNotifications])

  const notificationCount = Object.values(groupedNotifications).reduce(
    (acc, items) => acc + items.length,
    0
  )

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
    const term = query.trim().toLowerCase()
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
  }, [query, state.clientes, state.propostas, state.tarefas])

  const markNotificationAsRead = async (item: HeaderNotification) => {
    if (item.persistent) return
    setReadNotificationIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
    void fetch('/api/notificacoes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds: [item.id] }),
    })
  }

  const markAllActionNotificationsAsRead = async () => {
    if (actionNotifications.length === 0) return
    setReadNotificationIds((prev) => [
      ...new Set([...prev, ...actionNotifications.map((item) => item.id)]),
    ])
    void fetch('/api/notificacoes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds: actionNotifications.map((item) => item.id) }),
    })
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

          <DropdownMenu>
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
        <CommandInput placeholder="Digite para buscar..." value={query} onValueChange={setQuery} />
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
