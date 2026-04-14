'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { CRMHeader } from '@/components/crm/header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, FileText, TrendingUp, DollarSign, Clock, X, Pencil } from 'lucide-react'
import {
  statusPropostaColors,
  statusPropostaLabels,
  type StatusProposta,
} from '@/lib/data/types'

const openStatuses: StatusProposta[] = [
  'em_cotacao',
  'enviado_ao_cliente',
  'em_negociacao',
  'em_retificacao',
]

const tabs: { key: string; label: string; statuses?: StatusProposta[] }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'abertas', label: 'Em andamento', statuses: openStatuses },
  { key: 'fechadas', label: 'Fechadas', statuses: ['fechado'] },
  { key: 'perdidas', label: 'Perdidas', statuses: ['perdido'] },
]

export default function PropostasPage() {
  const { state, updateProposta, addProposta, getCliente, deleteProposta } = useCRM()
  const { formatCurrency, formatDate } = useAppSettings()
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'
  const [showAddForm, setShowAddForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [statusInicial, setStatusInicial] = useState<StatusProposta>('em_cotacao')
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [editValor, setEditValor] = useState('')
  const [editDescricao, setEditDescricao] = useState('')
  const [editClienteId, setEditClienteId] = useState('')
  const [editStatus, setEditStatus] = useState<StatusProposta>('em_cotacao')

  const propostasEmAndamento = state.propostas.filter((p) => openStatuses.includes(p.status))
  const propostasFechadas = state.propostas.filter((p) => p.status === 'fechado')
  const propostasPerdidas = state.propostas.filter((p) => p.status === 'perdido')

  const totalEmAndamento = propostasEmAndamento.reduce((acc, p) => acc + p.valor, 0)
  const totalFechado = propostasFechadas.reduce((acc, p) => acc + p.valor, 0)
  const totalPerdido = propostasPerdidas.reduce((acc, p) => acc + p.valor, 0)

  const taxaConversao =
    state.propostas.length > 0 ? ((propostasFechadas.length / state.propostas.length) * 100).toFixed(1) : '0'

  const handleAddProposta = async () => {
    if (!valor || !descricao.trim() || !clienteId || (isAdmin && !responsavelId)) return

    await addProposta({
      clienteId,
      valor: Number(valor),
      descricao,
      status: statusInicial,
      dataEnvio: new Date(),
      responsavelId: isAdmin ? responsavelId : user?.id,
    })

    setShowAddForm(false)
    setValor('')
    setDescricao('')
    setClienteId('')
    setResponsavelId('')
    setStatusInicial('em_cotacao')
  }

  const openEditDialog = (proposta: typeof state.propostas[0]) => {
    setEditingPropostaId(proposta.id)
    setEditValor(String(proposta.valor))
    setEditDescricao(proposta.descricao)
    setEditClienteId(proposta.clienteId)
    setEditStatus(proposta.status)
    setShowEditForm(true)
  }

  const handleSaveEdit = async () => {
    if (!editingPropostaId || !editValor || !editDescricao.trim() || !editClienteId) return

    await updateProposta({
      id: editingPropostaId,
      clienteId: editClienteId,
      valor: Number(editValor),
      descricao: editDescricao,
      status: editStatus,
      dataEnvio: new Date(),
      criadoEm: new Date(),
    })

    setShowEditForm(false)
    setEditingPropostaId(null)
  }

  const renderPropostaRow = (proposta: typeof state.propostas[0]) => {
    const cliente = getCliente(proposta.clienteId)
    const canManage = user?.role === 'admin' || proposta.responsavelId === user?.id

    return (
      <TableRow key={proposta.id} className="hover:bg-secondary/30">
        <TableCell>
          {cliente ? (
            <Link
              href={`/clientes/${cliente.id}`}
              className="font-medium text-foreground transition-colors hover:text-primary"
            >
              {cliente.nome}
            </Link>
          ) : (
            <span className="text-muted-foreground">Cliente nao encontrado</span>
          )}
        </TableCell>
        <TableCell className="font-semibold">{formatCurrency(proposta.valor)}</TableCell>
        <TableCell className="max-w-xs truncate text-muted-foreground">{proposta.descricao}</TableCell>
        <TableCell>
          <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
            {statusPropostaLabels[proposta.status]}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{formatDate(proposta.dataEnvio)}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && (
                <DropdownMenuItem onClick={() => openEditDialog(proposta)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar proposta
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => deleteProposta(proposta.id)} className="text-destructive">
                <X className="mr-2 h-4 w-4" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    )
  }

  const stats = [
    {
      title: 'Em Andamento',
      value: formatCurrency(totalEmAndamento),
      count: propostasEmAndamento.length,
      icon: Clock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Fechadas',
      value: formatCurrency(totalFechado),
      count: propostasFechadas.length,
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Perdidas',
      value: formatCurrency(totalPerdido),
      count: propostasPerdidas.length,
      icon: X,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
    },
    {
      title: 'Taxa de Conversao',
      value: `${taxaConversao}%`,
      count: state.propostas.length,
      icon: TrendingUp,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
  ]

  const filteredClientes = state.clientes.filter((cliente) =>
    cliente.nome.toLowerCase().includes(clienteSearch.toLowerCase())
  )
  const responsaveisDisponiveis = state.usuarios.filter(
    (usuario) => usuario.ativo && usuario.role !== 'admin'
  )

  return (
    <>
      <CRMHeader
        title="Propostas"
        subtitle="Gerencie suas propostas comerciais"
        action={{ label: 'Nova Proposta', onClick: () => setShowAddForm(true) }}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.title} className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.count} proposta{stat.count !== 1 ? 's' : ''}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${stat.bgColor}`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="todas">
          <TabsList className="mb-4">
            {tabs.map((tab) => {
              const count = tab.statuses
                ? state.propostas.filter((proposta) => tab.statuses?.includes(proposta.status)).length
                : state.propostas.length
              return (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label} ({count})
                </TabsTrigger>
              )
            })}
          </TabsList>

          {tabs.map((tab) => {
            const propostas = tab.statuses
              ? state.propostas.filter((proposta) => tab.statuses?.includes(proposta.status))
              : state.propostas

            return (
              <TabsContent key={tab.key} value={tab.key}>
                <Card className="bg-card border-border">
                  <div className="border-b border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                          <TableHead className="text-foreground">Cliente</TableHead>
                          <TableHead className="text-foreground">Valor</TableHead>
                          <TableHead className="text-foreground">Descricao</TableHead>
                          <TableHead className="text-foreground">Status</TableHead>
                          <TableHead className="text-foreground">Data</TableHead>
                          <TableHead className="w-12 text-foreground"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {propostas.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                              Nenhuma proposta encontrada
                            </TableCell>
                          </TableRow>
                        ) : (
                          propostas
                            .sort((a, b) => new Date(b.dataEnvio).getTime() - new Date(a.dataEnvio).getTime())
                            .map(renderPropostaRow)
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              </TabsContent>
            )
          })}
        </Tabs>
      </div>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Proposta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Buscar cliente..."
                      value={clienteSearch}
                      onChange={(event) => setClienteSearch(event.target.value)}
                    />
                  </div>
                  {filteredClientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status inicial</Label>
              <Select value={statusInicial} onValueChange={(value) => setStatusInicial(value as StatusProposta)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {openStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusPropostaLabels[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label>Responsavel</Label>
                <Select value={responsavelId} onValueChange={setResponsavelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o vendedor responsavel" />
                  </SelectTrigger>
                  <SelectContent>
                    {responsaveisDisponiveis.map((usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>
                        {usuario.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Valor</Label>
              <Input type="number" placeholder="0.00" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Descricao</Label>
              <Textarea
                placeholder="Descreva a proposta..."
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={4}
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void handleAddProposta()}
                disabled={!valor || !descricao.trim() || !clienteId || (isAdmin && !responsavelId)}
              >
                Criar Proposta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditForm} onOpenChange={setShowEditForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Proposta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={editClienteId} onValueChange={setEditClienteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {state.clientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={(value) => setEditStatus(value as StatusProposta)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusPropostaLabels).map(([status, label]) => (
                    <SelectItem key={status} value={status}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Valor</Label>
              <Input type="number" value={editValor} onChange={(event) => setEditValor(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Descricao</Label>
              <Textarea value={editDescricao} onChange={(event) => setEditDescricao(event.target.value)} rows={4} />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowEditForm(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void handleSaveEdit()} disabled={!editValor || !editDescricao.trim() || !editClienteId}>
                Salvar alteracoes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
}
