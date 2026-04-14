'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { useCRM } from '@/lib/context/crm-context'
import { useSession } from '@/lib/hooks/use-api'
import { CRMHeader } from '@/components/crm/header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Phone, Pencil } from 'lucide-react'
import { InfoTab } from '@/components/crm/clientes/tabs/info-tab'
import { HistoryTab } from '@/components/crm/clientes/tabs/history-tab'
import { TasksTab } from '@/components/crm/clientes/tabs/tasks-tab'
import { ProposalsTab } from '@/components/crm/clientes/tabs/proposals-tab'
import { ClientForm } from '@/components/crm/clientes/client-form'
import { ModuleAccessState } from '@/components/crm/module-access-state'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ClienteDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const { getCliente } = useCRM()
  const { user } = useSession()
  const [showEditForm, setShowEditForm] = useState(false)

  const cliente = getCliente(id)

  if (!hasModuleAccess(user, 'clientes')) {
    return <ModuleAccessState module="clientes" />
  }

  if (!cliente) {
    return (
      <>
        <CRMHeader title="Cliente nao encontrado" />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-4 text-muted-foreground">O cliente solicitado nao foi encontrado.</p>
            <Button onClick={() => router.push('/clientes')}>Voltar para Clientes</Button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <CRMHeader
        title={cliente.nome}
        subtitle={cliente.tipo === 'comercial' ? 'Cliente Comercial' : 'Cliente Residencial'}
        action={{ label: 'Editar', onClick: () => setShowEditForm(true) }}
      />

      <div className="flex-1 overflow-auto">
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="mb-4 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/clientes')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-foreground">{cliente.nome}</h2>
              </div>
              <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                <a href={`tel:${cliente.telefone}`} className="flex items-center gap-1 hover:text-primary">
                  <Phone className="h-4 w-4" />
                  {cliente.telefone}
                </a>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar Cliente
            </Button>
          </div>
        </div>

        <div className="p-6">
          <Tabs defaultValue="info" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="info">Informacoes</TabsTrigger>
              <TabsTrigger value="history">Historico</TabsTrigger>
              <TabsTrigger value="tasks">Tarefas</TabsTrigger>
              <TabsTrigger value="proposals">Propostas</TabsTrigger>
            </TabsList>

            <TabsContent value="info">
              <InfoTab cliente={cliente} />
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab clienteId={cliente.id} />
            </TabsContent>

            <TabsContent value="tasks">
              <TasksTab clienteId={cliente.id} />
            </TabsContent>

            <TabsContent value="proposals">
              <ProposalsTab clienteId={cliente.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ClientForm open={showEditForm} onClose={() => setShowEditForm(false)} cliente={cliente} />
    </>
  )
}
