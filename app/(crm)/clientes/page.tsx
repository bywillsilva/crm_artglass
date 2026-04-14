'use client'

import { useState } from 'react'
import { CRMHeader } from '@/components/crm/header'
import { ClientsTable } from '@/components/crm/clientes/clients-table'
import { ClientForm } from '@/components/crm/clientes/client-form'

export default function ClientesPage() {
  const [showNewClient, setShowNewClient] = useState(false)

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
      <div className="flex-1 overflow-auto p-6">
        <ClientsTable onNewClient={() => setShowNewClient(true)} />
      </div>

      <ClientForm
        open={showNewClient}
        onClose={() => setShowNewClient(false)}
      />
    </>
  )
}
