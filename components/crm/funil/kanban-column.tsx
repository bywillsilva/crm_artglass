'use client'

import { useState } from 'react'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { KanbanCard } from './kanban-card'
import type { Cliente, StatusFunil } from '@/lib/data/types'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  status: StatusFunil
  label: string
  color: string
  clientes: Cliente[]
  valorTotal: number
  onDragStart: (clienteId: string) => void
  onDragEnd: () => void
  onDrop: () => void
  isDragging: boolean
}

export function KanbanColumn({
  status,
  label,
  color,
  clientes,
  valorTotal,
  onDragStart,
  onDragEnd,
  onDrop,
  isDragging,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const { formatCurrency } = useAppSettings()

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    onDrop()
  }

  return (
    <div
      className={cn(
        'flex flex-col w-72 min-w-72 bg-card rounded-lg border-t-4 transition-colors',
        color,
        isDragOver && isDragging && 'bg-primary/5 ring-2 ring-primary/20'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header da coluna */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-foreground">{label}</h3>
          <span className="text-sm text-muted-foreground bg-secondary px-2 py-0.5 rounded">
            {clientes.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(valorTotal)}
        </p>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-20rem)]">
        {clientes.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            Arraste clientes aqui
          </div>
        ) : (
          clientes.map((cliente) => (
            <KanbanCard
              key={cliente.id}
              cliente={cliente}
              onDragStart={() => onDragStart(cliente.id)}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  )
}
