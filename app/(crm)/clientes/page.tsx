'use client'

import { useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { CRMHeader } from '@/components/crm/header'
import { ClientsTable } from '@/components/crm/clientes/clients-table'
import { ClientForm } from '@/components/crm/clientes/client-form'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { useSession } from '@/lib/hooks/use-api'

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
        <ClientsTable onNewClient={() => setShowNewClient(true)} />
      </div>

      <ClientForm
        open={showNewClient}
        onClose={() => setShowNewClient(false)}
      />
    </>
  )
}
