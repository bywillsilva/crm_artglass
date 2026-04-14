'use client'

import { useEffect, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, Target, TrendingUp, Users } from 'lucide-react'

export function StatsCards() {
  const [mounted, setMounted] = useState(false)
  const { state } = useCRM()
  const { formatCurrency } = useAppSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Card key={item} className="border-border bg-card">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-11 w-11 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const propostasEmAberto = state.propostas.filter((proposta) =>
    [
      'novo_cliente',
      'em_orcamento',
      'aguardando_aprovacao',
      'enviar_ao_cliente',
      'enviado_ao_cliente',
      'follow_up_1_dia',
      'follow_up_3_dias',
      'follow_up_7_dias',
      'stand_by',
      'em_retificacao',
    ].includes(proposta.status)
  )
  const vendasFechadas = state.propostas.filter((proposta) => proposta.status === 'fechado')
  const totalVendas = vendasFechadas.reduce((acc, proposta) => acc + proposta.valor, 0)
  const totalPropostas = state.propostas.length
  const taxaConversao =
    totalPropostas > 0 ? ((vendasFechadas.length / totalPropostas) * 100).toFixed(1) : '0'
  const ticketMedio = vendasFechadas.length > 0 ? totalVendas / vendasFechadas.length : 0

  const stats = [
    {
      title: 'Leads em Proposta',
      value: propostasEmAberto.length.toString(),
      description: 'Propostas em aberto',
      icon: Users,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Vendas do Mes',
      value: formatCurrency(totalVendas),
      description: `${vendasFechadas.length} contratos fechados`,
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Taxa de Conversao',
      value: `${taxaConversao}%`,
      description: 'Propostas x fechamentos',
      icon: TrendingUp,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Ticket Medio',
      value: formatCurrency(ticketMedio),
      description: 'Por venda fechada',
      icon: Target,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title} className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{stat.title}</p>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </div>
              <div className={`rounded-lg p-3 ${stat.bgColor}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
