'use client'

import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Phone, Mail, Building2, Calendar, DollarSign, User, Briefcase } from 'lucide-react'
import type { Cliente } from '@/lib/data/types'

interface InfoTabProps {
  cliente: Cliente
}

export function InfoTab({ cliente }: InfoTabProps) {
  const { formatDate, formatCurrency } = useAppSettings()

  const infoItems = [
    { icon: Phone, label: 'Telefone', value: cliente.telefone, href: `tel:${cliente.telefone}` },
    { icon: Mail, label: 'E-mail', value: cliente.email, href: `mailto:${cliente.email}` },
    { icon: MapPin, label: 'Endereco', value: cliente.endereco },
    { icon: Building2, label: 'Tipo', value: cliente.tipo === 'comercial' ? 'Comercial' : 'Residencial' },
    ...(cliente.empresa ? [{ icon: Building2, label: 'Empresa', value: cliente.empresa }] : []),
    ...(cliente.cargo ? [{ icon: Briefcase, label: 'Cargo', value: cliente.cargo }] : []),
    { icon: User, label: 'Origem', value: cliente.origem },
    { icon: Calendar, label: 'Cliente desde', value: formatDate(cliente.criadoEm) },
    { icon: Calendar, label: 'Ultimo contato', value: formatDate(cliente.ultimoContato) },
    { icon: DollarSign, label: 'Valor estimado', value: formatCurrency(cliente.valorEstimado) },
  ]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Informacoes do Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {infoItems.map((item) => (
            <div key={item.label} className="flex items-start gap-3">
              <div className="rounded-lg bg-secondary p-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{item.label}</p>
                {item.href ? (
                  <a href={item.href} className="text-foreground transition-colors hover:text-primary">
                    {item.value}
                  </a>
                ) : (
                  <p className="text-foreground">{item.value}</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-6">
        {cliente.observacoes && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg">Observacoes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-muted-foreground">{cliente.observacoes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
