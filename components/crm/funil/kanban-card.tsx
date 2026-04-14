'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DollarSign, Calendar, GripVertical } from 'lucide-react'
import type { Cliente } from '@/lib/data/types'
import { cn } from '@/lib/utils'

interface KanbanCardProps {
  cliente: Cliente
  onDragStart: () => void
  onDragEnd: () => void
}

export function KanbanCard({ cliente, onDragStart, onDragEnd }: KanbanCardProps) {
  const { formatCurrency, formatDate } = useAppSettings()
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    onDragStart()
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    onDragEnd()
  }

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'cursor-grab active:cursor-grabbing transition-all hover:border-primary/50',
        isDragging && 'opacity-50 scale-95'
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <GripVertical className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            {/* Nome do cliente */}
            <Link
              href={`/clientes/${cliente.id}`}
              className="font-medium text-foreground hover:text-primary transition-colors line-clamp-1"
              onClick={(e) => e.stopPropagation()}
            >
              {cliente.nome}
            </Link>

            {/* Tipo */}
            <Badge
              variant="outline"
              className="mt-1 text-xs bg-secondary/50"
            >
              {cliente.tipo === 'comercial' ? 'Comercial' : 'Residencial'}
            </Badge>

            {/* Valor */}
            <div className="flex items-center gap-1 mt-2 text-sm">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {formatCurrency(cliente.valorEstimado)}
              </span>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                {formatDate(cliente.ultimoContato)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
