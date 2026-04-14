'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileText,
  Kanban,
  LayoutDashboard,
  Sun,
  UserCog,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { cn } from '@/lib/utils'

const menuItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Clientes', href: '/clientes', icon: Users },
  { title: 'Funil de Vendas', href: '/funil', icon: Kanban },
  { title: 'Tarefas', href: '/tarefas', icon: CheckSquare },
  { title: 'Propostas', href: '/propostas', icon: FileText },
  { title: 'Relatorios', href: '/relatorios', icon: BarChart3, adminOnly: true },
  { title: 'Performance', href: '/relatorios/vendedores', icon: BarChart3, adminOnly: true },
  { title: 'Usuarios', href: '/usuarios', icon: UserCog, adminOnly: true },
]

export function CRMSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const { company } = useAppSettings()
  const { user } = useSession()

  const visibleMenuItems = menuItems.filter((item) => !item.adminOnly || user?.role === 'admin')

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sun className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-sidebar-foreground">
              {company.nome || 'CRM'}
            </span>
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
  )
}
