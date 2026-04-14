'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Search, MoreHorizontal, Eye, Pencil, Trash2, Phone } from 'lucide-react'
import type { Cliente } from '@/lib/data/types'
import { ClientForm } from './client-form'

interface ClientsTableProps {
  onNewClient: () => void
}

export function ClientsTable({ onNewClient }: ClientsTableProps) {
  const { state, deleteCliente } = useCRM()
  const { formatCurrency, formatDate } = useAppSettings()
  const [search, setSearch] = useState('')
  const [editingClient, setEditingClient] = useState<Cliente | null>(null)

  const filteredClientes = state.clientes.filter((cliente) => {
    const matchesSearch =
      cliente.nome.toLowerCase().includes(search.toLowerCase()) ||
      cliente.telefone.includes(search) ||
      cliente.email.toLowerCase().includes(search.toLowerCase())

    return matchesSearch
  })

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              <TableHead className="text-foreground">Cliente</TableHead>
              <TableHead className="text-foreground">Contato</TableHead>
              <TableHead className="text-foreground">Valor Est.</TableHead>
              <TableHead className="text-foreground">Ultimo Contato</TableHead>
              <TableHead className="w-12 text-foreground"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhum cliente encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredClientes.map((cliente) => {
                return (
                  <TableRow key={cliente.id} className="hover:bg-secondary/30">
                    <TableCell>
                      <div>
                        <Link
                          href={`/clientes/${cliente.id}`}
                          className="font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {cliente.nome}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {cliente.tipo === 'comercial' ? 'Comercial' : 'Residencial'} | {cliente.origem}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <a
                          href={`tel:${cliente.telefone}`}
                          className="flex items-center gap-1 text-sm text-foreground hover:text-primary"
                        >
                          <Phone className="h-3 w-3" />
                          {cliente.telefone}
                        </a>
                        <p className="text-xs text-muted-foreground">{cliente.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(cliente.valorEstimado)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(cliente.ultimoContato)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/clientes/${cliente.id}`}>
                              <Eye className="mr-2 h-4 w-4" />
                              Ver detalhes
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingClient(cliente)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteCliente(cliente.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Exibindo {filteredClientes.length} de {state.clientes.length} clientes
        </p>
        <p>
          Valor total:{' '}
          <span className="font-medium text-foreground">
            {formatCurrency(filteredClientes.reduce((acc, cliente) => acc + cliente.valorEstimado, 0))}
          </span>
        </p>
      </div>

      {editingClient && (
        <ClientForm
          open={!!editingClient}
          onClose={() => setEditingClient(null)}
          cliente={editingClient}
        />
      )}
    </>
  )
}
