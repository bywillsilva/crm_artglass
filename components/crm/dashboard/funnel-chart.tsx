'use client'

import { useEffect, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts'
import { statusPropostaLabels, type StatusProposta } from '@/lib/data/types'

const funilStages: { status: StatusProposta; color: string }[] = [
  { status: 'novo_cliente', color: '#0ea5e9' },
  { status: 'em_orcamento', color: '#64748b' },
  { status: 'aguardando_aprovacao', color: '#8b5cf6' },
  { status: 'enviar_ao_cliente', color: '#2563eb' },
  { status: 'enviado_ao_cliente', color: '#3b82f6' },
  { status: 'follow_up_1_dia', color: '#10b981' },
  { status: 'follow_up_3_dias', color: '#059669' },
  { status: 'follow_up_7_dias', color: '#047857' },
  { status: 'stand_by', color: '#71717a' },
  { status: 'em_retificacao', color: '#a855f7' },
  { status: 'fechado', color: '#10b981' },
  { status: 'perdido', color: '#ef4444' },
]

export function FunnelChart() {
  const [mounted, setMounted] = useState(false)
  const { state } = useCRM()
  const { formatCurrency } = useAppSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Funil de Propostas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {funilStages.map((stage) => (
              <div key={stage.status} className="flex items-center gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 flex-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const data = funilStages.map((stage) => {
    const propostas = state.propostas.filter((proposta) => proposta.status === stage.status)
    return {
      name: statusPropostaLabels[stage.status],
      count: propostas.length,
      valor: propostas.reduce((acc, proposta) => acc + proposta.valor, 0),
      color: stage.color,
    }
  })

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg text-foreground">Funil de Propostas</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={140} tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload
                  return (
                    <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
                      <p className="font-medium text-foreground">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.count} propostas</p>
                      <p className="text-sm text-muted-foreground">{formatCurrency(item.valor)}</p>
                    </div>
                  )
                }
                return null
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
