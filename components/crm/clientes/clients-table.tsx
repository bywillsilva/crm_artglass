'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Search, MoreHorizontal, Eye, Pencil, Trash2, Phone } from 'lucide-react'
import type { Cliente } from '@/lib/data/types'
import { ClientForm } from './client-form'

interface ClientsTableProps {
  onNewClient: () => void
}

const PAGE_SIZE_OPTIONS = [10, 50, 100] as const

export function ClientsTable({ onNewClient }: ClientsTableProps) {
  const { state, deleteCliente } = useCRM()
  const { formatDate } = useAppSettings()
  const { user } = useSession()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [editingClient, setEditingClient] = useState<Cliente | null>(null)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [currentPage, setCurrentPage] = useState(1)
  const canEditClient = hasRuleAccess(user, 'canEditClientsDirectly')

  const filteredClientes = useMemo(
    () =>
      state.clientes.filter((cliente) => {
        const matchesSearch =
          cliente.nome.toLowerCase().includes(deferredSearch.toLowerCase()) ||
          cliente.telefone.includes(deferredSearch) ||
          cliente.email.toLowerCase().includes(deferredSearch.toLowerCase())

        return matchesSearch
      }),
    [deferredSearch, state.clientes]
  )

  const totalPages = Math.max(1, Math.ceil(filteredClientes.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const paginatedClientes = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize
    return filteredClientes.slice(startIndex, startIndex + pageSize)
  }, [filteredClientes, pageSize, safeCurrentPage])
  const paginationStart = filteredClientes.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1
  const paginationEnd = filteredClientes.length === 0 ? 0 : paginationStart + paginatedClientes.length - 1

  useEffect(() => {
    setCurrentPage(1)
  }, [pageSize, search])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const getOrigemLabel = (origem?: string) => origem?.trim() || 'Nao informado'

  const buildPageItems = (page: number, total: number) => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1)
    }

    if (page <= 3) {
      return [1, 2, 3, 4, 'ellipsis-end', total] as const
    }

    if (page >= total - 2) {
      return [1, 'ellipsis-start', total - 3, total - 2, total - 1, total] as const
    }

    return [1, 'ellipsis-start', page - 1, page, page + 1, 'ellipsis-end', total] as const
  }

  const pageItems = buildPageItems(safeCurrentPage, totalPages)

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

      {filteredClientes.length === 0 ? (
        <div className="rounded-lg border border-border py-8 text-center text-muted-foreground">
          Nenhum cliente encontrado
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {paginatedClientes.map((cliente) => (
              <div key={cliente.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <Link
                      href={`/clientes/${cliente.id}`}
                      className="block truncate font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {cliente.nome}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {cliente.tipo === 'comercial' ? 'Comercial' : 'Residencial'} | {getOrigemLabel(cliente.origem)}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
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
                      {canEditClient ? (
                        <DropdownMenuItem onClick={() => setEditingClient(cliente)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          void deleteCliente(cliente.id)
                            .then(() => {
                              toast.success('Cliente excluido com sucesso.')
                            })
                            .catch((error: any) => {
                              toast.error(error?.message || 'Nao foi possivel excluir o cliente.')
                            })
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-3 space-y-2">
                  <a
                    href={`tel:${cliente.telefone}`}
                    className="flex items-center gap-2 text-sm text-foreground hover:text-primary"
                  >
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="truncate">{cliente.telefone}</span>
                  </a>
                  <p className="truncate text-xs text-muted-foreground">{cliente.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Ultimo contato: {formatDate(cliente.ultimoContato)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                    <TableHead className="text-foreground">Cliente</TableHead>
                    <TableHead className="text-foreground">Contato</TableHead>
                    <TableHead className="text-foreground">Ultimo Contato</TableHead>
                    <TableHead className="w-12 text-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedClientes.map((cliente) => {
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
                              {cliente.tipo === 'comercial' ? 'Comercial' : 'Residencial'} | {getOrigemLabel(cliente.origem)}
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
                              {canEditClient ? (
                                <DropdownMenuItem onClick={() => setEditingClient(cliente)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Editar
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  void deleteCliente(cliente.id)
                                    .then(() => {
                                      toast.success('Cliente excluido com sucesso.')
                                    })
                                    .catch((error: any) => {
                                      toast.error(error?.message || 'Nao foi possivel excluir o cliente.')
                                    })
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <p>
            Exibindo {paginationStart}-{paginationEnd} de {filteredClientes.length} clientes
          </p>
          <div className="flex items-center gap-2">
            <span>Por pagina</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])}
            >
              <SelectTrigger className="h-8 w-[118px] text-xs">
                <SelectValue placeholder="Quantidade" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} clientes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {filteredClientes.length > pageSize ? (
          <Pagination className="mx-0 w-auto justify-start sm:justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  className={safeCurrentPage <= 1 ? 'pointer-events-none opacity-50' : ''}
                  onClick={(event) => {
                    event.preventDefault()
                    if (safeCurrentPage > 1) {
                      setCurrentPage((page) => page - 1)
                    }
                  }}
                />
              </PaginationItem>
              {pageItems.map((item, index) => (
                <PaginationItem key={`${item}-${index}`}>
                  {item === 'ellipsis-start' || item === 'ellipsis-end' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      href="#"
                      isActive={safeCurrentPage === item}
                      onClick={(event) => {
                        event.preventDefault()
                        setCurrentPage(Number(item))
                      }}
                    >
                      {item}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  className={safeCurrentPage >= totalPages ? 'pointer-events-none opacity-50' : ''}
                  onClick={(event) => {
                    event.preventDefault()
                    if (safeCurrentPage < totalPages) {
                      setCurrentPage((page) => page + 1)
                    }
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>

      {editingClient && canEditClient ? (
        <ClientForm
          open={!!editingClient}
          onClose={() => setEditingClient(null)}
          cliente={editingClient}
        />
      ) : null}
    </>
  )
}
