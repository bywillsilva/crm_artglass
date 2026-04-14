'use client'

import { useMemo, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { statusPropostaColors, statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'

const columns: StatusProposta[] = [
  'em_cotacao',
  'enviado_ao_cliente',
  'em_negociacao',
  'em_retificacao',
  'fechado',
  'perdido',
]

const topBorderColors: Record<StatusProposta, string> = {
  em_cotacao: 'border-slate-500',
  enviado_ao_cliente: 'border-blue-500',
  em_negociacao: 'border-amber-500',
  em_retificacao: 'border-purple-500',
  fechado: 'border-emerald-500',
  perdido: 'border-red-500',
}

interface KanbanBoardProps {
  propostas?: Proposta[]
}

export function KanbanBoard({ propostas }: KanbanBoardProps) {
  const { state, updatePropostaStatus, addInteracao, getCliente, getUsuario } = useCRM()
  const { formatCurrency, formatDate } = useAppSettings()
  const { user } = useSession()
  const [draggedPropostaId, setDraggedPropostaId] = useState<string | null>(null)

  const propostasVisiveis = useMemo(() => {
    const source = propostas || state.propostas
    if (user?.role === 'admin') return source
    return source.filter((proposta) => proposta.responsavelId === user?.id)
  }, [propostas, state.propostas, user?.id, user?.role])

  const handleDrop = async (novoStatus: StatusProposta) => {
    if (!draggedPropostaId) return

    const proposta = propostasVisiveis.find((item) => item.id === draggedPropostaId)
    if (!proposta || proposta.status === novoStatus) {
      setDraggedPropostaId(null)
      return
    }

    await updatePropostaStatus(proposta.id, novoStatus)
    await addInteracao({
      clienteId: proposta.clienteId,
      tipo: 'proposta',
      descricao: `Proposta movida para ${statusPropostaLabels[novoStatus]}`,
      usuarioId: user?.id || proposta.responsavelId || '',
      dados: { proposta_id: proposta.id, status: novoStatus },
    })

    setDraggedPropostaId(null)
  }

  return (
    <div className="flex min-h-[calc(100vh-12rem)] gap-4 overflow-x-auto pb-4">
      {columns.map((status) => {
        const propostas = propostasVisiveis.filter((proposta) => proposta.status === status)
        const valorTotal = propostas.reduce((acc, proposta) => acc + proposta.valor, 0)

        return (
          <div
            key={status}
            className={`flex w-80 min-w-80 flex-col rounded-lg border-t-4 bg-card ${topBorderColors[status]}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void handleDrop(status)}
          >
            <div className="border-b border-border p-4">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{statusPropostaLabels[status]}</h3>
                <span className="rounded bg-secondary px-2 py-0.5 text-sm text-muted-foreground">
                  {propostas.length}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{formatCurrency(valorTotal)}</p>
            </div>

            <div className="flex-1 space-y-3 p-3">
              {propostas.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  Nenhuma proposta nesta etapa
                </div>
              ) : (
                propostas.map((proposta) => {
                  const cliente = getCliente(proposta.clienteId)
                  const responsavel = proposta.responsavelId ? getUsuario(proposta.responsavelId) : undefined

                  return (
                    <Card
                      key={proposta.id}
                      draggable
                      onDragStart={() => setDraggedPropostaId(proposta.id)}
                      onDragEnd={() => setDraggedPropostaId(null)}
                      className="cursor-grab border-border transition-all hover:border-primary/50 active:cursor-grabbing"
                    >
                      <CardHeader className="space-y-2 p-4 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base text-foreground">
                            {proposta.titulo || 'Proposta Comercial'}
                          </CardTitle>
                          <Badge variant="outline" className={statusPropostaColors[status]}>
                            {formatCurrency(proposta.valor)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {cliente?.nome || 'Cliente nao encontrado'}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0">
                        <p className="line-clamp-3 text-sm text-muted-foreground">{proposta.descricao}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{formatDate(proposta.dataEnvio)}</span>
                          {responsavel && (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="bg-primary/20 text-xs text-primary">
                                  {responsavel.avatar}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs text-muted-foreground">
                                {responsavel.nome.split(' ')[0]}
                              </span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
