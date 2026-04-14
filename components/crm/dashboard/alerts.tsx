'use client'

import { useState, useEffect } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Clock, FileText } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'

export function Alerts() {
  const [mounted, setMounted] = useState(false)
  const { getClientesSemTarefa, getTarefasAtrasadas, getPropostasEmAberto, getCliente } = useCRM()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">Alertas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-lg border border-border bg-secondary/30">
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  const clientesSemTarefa = getClientesSemTarefa()
  const tarefasAtrasadas = getTarefasAtrasadas()
  const propostasEmAberto = getPropostasEmAberto()

  const alerts = [
    {
      icon: AlertTriangle,
      title: 'Clientes sem tarefa',
      description: `${clientesSemTarefa.length} cliente${clientesSemTarefa.length !== 1 ? 's' : ''} sem próxima ação`,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      items: clientesSemTarefa.slice(0, 3).map((c) => ({
        id: c.id,
        label: c.nome,
        href: `/clientes/${c.id}`,
      })),
    },
    {
      icon: Clock,
      title: 'Tarefas atrasadas',
      description: `${tarefasAtrasadas.length} tarefa${tarefasAtrasadas.length !== 1 ? 's' : ''} pendente${tarefasAtrasadas.length !== 1 ? 's' : ''}`,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      items: tarefasAtrasadas.slice(0, 3).map((t) => {
        const cliente = getCliente(t.clienteId)
        return {
          id: t.id,
          label: cliente?.nome || 'Cliente',
          href: `/clientes/${t.clienteId}`,
        }
      }),
    },
    {
      icon: FileText,
      title: 'Propostas pendentes',
      description: `${propostasEmAberto.length} proposta${propostasEmAberto.length !== 1 ? 's' : ''} aguardando`,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      items: propostasEmAberto.slice(0, 3).map((p) => {
        const cliente = getCliente(p.clienteId)
        return {
          id: p.id,
          label: cliente?.nome || 'Cliente',
          href: `/clientes/${p.clienteId}`,
        }
      }),
    },
  ]

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground text-lg">Alertas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.map((alert) => (
          <div
            key={alert.title}
            className="p-4 rounded-lg border border-border bg-secondary/30"
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${alert.bgColor}`}>
                <alert.icon className={`w-4 h-4 ${alert.color}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{alert.title}</p>
                <p className="text-xs text-muted-foreground">{alert.description}</p>
                {alert.items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {alert.items.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="block text-xs text-primary hover:underline truncate"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
