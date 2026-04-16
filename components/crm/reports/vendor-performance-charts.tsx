'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const chartColors = ['#0f766e', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#059669']

interface VendorPerformanceChartsProps {
  formatCurrency: (value: number) => string
  revenueChartData: Array<{ name: string; receita: number; conversao: number }>
  proposalMixData: Array<{ name: string; value: number }>
  budgetChartData: Array<{ name: string; recebidas: number; aprovadas: number; retificadas: number }>
}

export function VendorPerformanceCharts({
  formatCurrency,
  revenueChartData,
  proposalMixData,
  budgetChartData,
}: VendorPerformanceChartsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Receita por Vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `R$${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value: number) => [formatCurrency(value), 'Receita']} />
                <Bar dataKey="receita" radius={[8, 8, 0, 0]}>
                  {revenueChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Volume de Propostas por Vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={proposalMixData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {proposalMixData.map((entry, index) => (
                    <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [`${value} propostas`, 'Volume']} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Performance de Orcamentistas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={budgetChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="recebidas" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="aprovadas" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="retificadas" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
