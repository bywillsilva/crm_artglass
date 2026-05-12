'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { CRMHeader } from '@/components/crm/header'
import { FeatureErrorBoundary } from '@/components/crm/feature-error-boundary'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { useSession } from '@/lib/hooks/use-api'

const ClientsTable = dynamic(
  () => import('@/components/crm/clientes/clients-table').then((mod) => mod.ClientsTable),
  { ssr: false }
)

const ClientForm = dynamic(
  () => import('@/components/crm/clientes/client-form').then((mod) => mod.ClientForm),
  { ssr: false }
)

export default function ClientesPage() {
  const { user } = useSession()
  const [showNewClient, setShowNewClient] = useState(false)

  if (!hasModuleAccess(user, 'clientes')) {
    return <ModuleAccessState module="clientes" />
  }

  return (
    <>
      <CRMHeader
        title="Clientes"
        subtitle="Gerencie sua base de clientes"
        action={{
          label: 'Novo Cliente',
          onClick: () => setShowNewClient(true),
        }}
      />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <FeatureErrorBoundary
          title="A listagem de clientes encontrou um erro temporario"
          description="Se algo inesperado acontecer aqui, a tela continua utilizavel e o usuario pode tentar novamente sem perder toda a sessao."
        >
          <ClientsTable onNewClient={() => setShowNewClient(true)} />
        </FeatureErrorBoundary>
      </div>

      {showNewClient ? <ClientForm open={showNewClient} onClose={() => setShowNewClient(false)} /> : null}
    </>
  )
}
