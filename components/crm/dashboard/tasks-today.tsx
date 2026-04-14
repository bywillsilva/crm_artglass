'use client'

import { useState, useEffect } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Clock, User } from 'lucide-react'
import Link from 'next/link'

export function TasksToday() {
  const [mounted, setMounted] = useState(false)
  const { getTarefasHoje, updateTarefaStatus, getCliente, getUsuario } = useCRM()
  const { formatTime } = useAppSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-foreground text-lg">Tarefas de Hoje</CardTitle>
          <Skeleton className="h-8 w-20" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50">
                <Skeleton className="h-4 w-4 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const tarefasHoje = getTarefasHoje()

  const handleComplete = (id: string) => {
    updateTarefaStatus(id, 'concluida')
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground text-lg">Tarefas de Hoje</CardTitle>
        <Link href="/tarefas">
          <Button variant="ghost" size="sm" className="text-primary">
            Ver todas
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {tarefasHoje.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhuma tarefa para hoje
          </p>
        ) : (
          <div className="space-y-3">
            {tarefasHoje.slice(0, 5).map((tarefa) => {
              const cliente = getCliente(tarefa.clienteId)
              const responsavel = getUsuario(tarefa.responsavelId)

              return (
                <div
                  key={tarefa.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <Checkbox
                    checked={tarefa.status === 'concluida'}
                    onCheckedChange={() => handleComplete(tarefa.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {tarefa.descricao}
                    </p>
                    {cliente && (
                      <Link
                        href={`/clientes/${cliente.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {cliente.nome}
                      </Link>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatTime(tarefa.dataHora)}
                      </span>
                      {responsavel && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          {responsavel.nome.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
