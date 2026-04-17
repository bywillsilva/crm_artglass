'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { CRMHeader } from '@/components/crm/header'
import { DateRangeFilter } from '@/components/crm/date-range-filter'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useCRM } from '@/lib/context/crm-context'
import { useSession } from '@/lib/hooks/use-api'
import { createDefaultDateFilter, isWithinDateFilter } from '@/lib/utils/date-filter'

const KanbanBoard = dynamic(
  () => import('@/components/crm/funil/kanban-board').then((mod) => mod.KanbanBoard),
  {
    ssr: false,
    loading: () => <FunilBoardSkeleton />,
  }
)

const ProposalFormDialog = dynamic(
  () => import('@/components/crm/propostas/proposal-form-dialog').then((mod) => mod.ProposalFormDialog),
  {
    ssr: false,
  }
)

export default function FunilPage() {
  const { state } = useCRM()
  const { user } = useSession()
  const [dateFilter, setDateFilter] = useState(createDefaultDateFilter())
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const hasFunilAccess = hasModuleAccess(user, 'funil')

  const propostasFiltradas = useMemo(
    () =>
      state.propostas.filter((proposta) =>
        isWithinDateFilter(proposta.criadoEm ?? proposta.dataEnvio, dateFilter)
      ),
    [dateFilter, state.propostas]
  )

  if (!hasFunilAccess) {
    return <ModuleAccessState module="funil" />
  }

  const subtitle =
    user?.role === 'vendedor'
      ? 'Acompanhe suas propostas e atualize o status conforme o fluxo comercial'
      : 'Arraste as propostas entre as etapas do funil'

  return (
    <>
      <CRMHeader
        title="Funil de Vendas"
        subtitle={subtitle}
        action={{ label: 'Nova Proposta', onClick: () => setShowCreateDialog(true) }}
      />
      <div className="flex-1 overflow-hidden p-6 space-y-6">
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        <KanbanBoard propostas={propostasFiltradas} />
      </div>
      {showCreateDialog ? (
        <ProposalFormDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
      ) : null}
    </>
  )
}

function FunilBoardSkeleton() {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] gap-4 overflow-hidden pb-4">
      {[1, 2, 3, 4].map((column) => (
        <div key={column} className="flex w-80 min-w-80 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
          <div className="space-y-3 p-3">
            {[1, 2, 3].map((card) => (
              <div key={card} className="rounded-xl border border-border p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-3 h-6 w-20" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
