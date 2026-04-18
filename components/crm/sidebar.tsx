'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  Kanban,
  LayoutDashboard,
  Sun,
  UserCog,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { hasModuleAccess, type ModuleKey } from '@/lib/auth/module-access'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { cn } from '@/lib/utils'

const menuItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: 'dashboard' as ModuleKey },
  { title: 'Clientes', href: '/clientes', icon: Users, module: 'clientes' as ModuleKey },
  { title: 'Funil de Vendas', href: '/funil', icon: Kanban, module: 'funil' as ModuleKey },
  { title: 'Propostas', href: '/propostas', icon: FileText, module: 'propostas' as ModuleKey },
  { title: 'Tarefas', href: '/tarefas', icon: CheckSquare, module: 'tarefas' as ModuleKey },
  { title: 'Relatorios', href: '/relatorios', icon: BarChart3, module: 'relatorios' as ModuleKey },
  { title: 'Performance', href: '/relatorios/vendedores', icon: BarChart3, module: 'performance' as ModuleKey },
  { title: 'Usuarios', href: '/usuarios', icon: UserCog, module: 'usuarios' as ModuleKey },
]

export function CRMSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { company, general } = useAppSettings()
  const { user } = useSession()

  const visibleMenuItems = menuItems.filter((item) => hasModuleAccess(user, item.module))

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOpen = () => setMobileOpen(true)
    window.addEventListener('crm-mobile-sidebar:open', handleOpen)
    return () => window.removeEventListener('crm-mobile-sidebar:open', handleOpen)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const previousOverflow = document.body.style.overflow
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileOpen])

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 md:flex',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Sun className="h-5 w-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-sidebar-foreground">
                  {company.nome || 'CRM'}
                </span>
                {general.demoMode && (
                  <Badge variant="outline" className="mt-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
                    Modo Demo
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-4">
          {visibleMenuItems.map((item) => {
            const isActive =
              item.href === '/relatorios'
                ? pathname === '/relatorios'
                : pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-sidebar-primary')} />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="mr-2 h-4 w-4" />
                <span>Recolher</span>
              </>
            )}
          </Button>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[min(84vw,20rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                  <Sun className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-sidebar-foreground">
                    {company.nome || 'CRM'}
                  </p>
                  {general.demoMode ? (
                    <Badge variant="outline" className="mt-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
                      Modo Demo
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                aria-label="Fechar menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
              {visibleMenuItems.map((item) => {
                const isActive =
                  item.href === '/relatorios'
                    ? pathname === '/relatorios'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-primary'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-sidebar-primary')} />
                    <span>{item.title}</span>
                  </Link>
                )
              })}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  )
}
