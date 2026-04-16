'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type FunnelChartItem = {
  name: string
  value: number
  valor: number
  color: string
}

type SalesChartItem = {
  name: string
  valor: number
  quantidade: number
}

type DashboardChartsProps = {
  funnelChartData: FunnelChartItem[]
  salesChartData: SalesChartItem[]
  formatCurrency: (value: number) => string
}

export function DashboardCharts({
  funnelChartData,
  salesChartData,
  formatCurrency,
}: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">Funil de Propostas</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={funnelChartData} layout="vertical">
              <XAxis type="number" stroke="#666" />
              <YAxis type="category" dataKey="name" stroke="#666" width={140} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                formatter={(value: number) => [`${value} propostas`, 'Quantidade']}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {funnelChartData.map((entry, index) => (
                  <Cell key={`funnel-${entry.name}-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">Fechamentos Mensais</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={salesChartData}>
              <XAxis dataKey="name" stroke="#666" />
              <YAxis stroke="#666" tickFormatter={(value) => `R$${value / 1000}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
                formatter={(value: number) => [formatCurrency(value), 'Valor']}
              />
              <Area
                type="monotone"
                dataKey="valor"
                stroke="#10b981"
                fill="#10b98133"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
