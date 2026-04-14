'use client'

import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { KanbanBoard } from '@/components/crm/funil/kanban-board'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { ProposalFormDialog } from '@/components/crm/propostas/proposal-form-dialog'
import { useCRM } from '@/lib/context/crm-context'
import { useSession } from '@/lib/hooks/use-api'
import { createDefaultDateFilter, isWithinDateFilter } from '@/lib/utils/date-filter'

export default function FunilPage() {
  const { state } = useCRM()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  if (!hasModuleAccess(user, 'funil')) {
    return <ModuleAccessState module="funil" />
  }

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
        action={{ label: 'Nova Proposta', onClick: () => setShowCreateDialog(true) }}
      />
      <div className="flex-1 overflow-hidden p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        <KanbanBoard propostas={propostasFiltradas} />
      </div>
      <ProposalFormDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </>
  )
}
