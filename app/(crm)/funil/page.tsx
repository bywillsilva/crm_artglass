'use client'

import { useMemo, useState } from 'react'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { KanbanBoard } from '@/components/crm/funil/kanban-board'
import { useCRM } from '@/lib/context/crm-context'
import { createDefaultDateFilter, isWithinDateFilter } from '@/lib/utils/date-filter'

export default function FunilPage() {
  const { state } = useCRM()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())

  const propostasFiltradas = useMemo(
    () =>
      state.propostas.filter((proposta) =>
        isWithinDateFilter(proposta.criadoEm ?? proposta.dataEnvio, dateFilter)
      ),
    [dateFilter, state.propostas]
  )

  return (
    <>
      <CRMHeader
        title="Funil de Vendas"
        subtitle="Arraste as propostas entre as etapas do funil"
      />
      <div className="flex-1 overflow-hidden p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        <KanbanBoard propostas={propostasFiltradas} />
      </div>
    </>
  )
}
