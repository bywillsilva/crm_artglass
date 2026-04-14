'use client'

import { useState, useEffect } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'

export function RankingChart() {
  const [mounted, setMounted] = useState(false)
  const { state } = useCRM()
  const { formatCurrency } = useAppSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">Ranking de Vendedores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  // Calcula vendas por vendedor
  const vendedoresRanking = state.usuarios
    .filter((u) => u.role === 'vendedor' || u.role === 'gerente')
    .map((vendedor) => {
      const propostasAprovadas = state.propostas.filter(
        (p) => p.status === 'fechado' && p.responsavelId === vendedor.id
      )
      const totalVendas = propostasAprovadas.reduce((acc, p) => acc + p.valor, 0)
      const qtdVendas = propostasAprovadas.length

      return {
        ...vendedor,
        totalVendas,
        qtdVendas,
      }
    })
    .sort((a, b) => b.totalVendas - a.totalVendas)

  const maxVendas = Math.max(...vendedoresRanking.map((v) => v.totalVendas), 1)

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground text-lg">Ranking de Vendedores</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {vendedoresRanking.map((vendedor, index) => (
          <div key={vendedor.id} className="flex items-center gap-4">
            <span className="text-lg font-bold text-muted-foreground w-6">
              {index + 1}
            </span>
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-primary/20 text-primary text-sm">
                {vendedor.avatar}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground truncate">
                  {vendedor.nome}
                </span>
                <span className="text-sm font-semibold text-foreground ml-2">
                  {formatCurrency(vendedor.totalVendas)}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{
                    width: `${(vendedor.totalVendas / maxVendas) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {vendedor.qtdVendas} venda{vendedor.qtdVendas !== 1 ? 's' : ''} fechada{vendedor.qtdVendas !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
