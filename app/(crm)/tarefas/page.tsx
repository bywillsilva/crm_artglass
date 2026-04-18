'use client'

import { useMemo, useState } from 'react'
import { hasModuleAccess } from '@/lib/auth/module-access'
import { createTarefa, updateTarefa, updateTarefaStatus, deleteTarefa, useSession } from '@/lib/hooks/use-api'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useCRM } from '@/lib/context/crm-context'
import { CRMHeader } from '@/components/crm/header'
import { ModuleAccessState } from '@/components/crm/module-access-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Label } from '@/components/ui/label'
import { Clock, User, Trash2, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths } from 'date-fns'
import Link from 'next/link'
import { toast } from 'sonner'
import { Cliente, Tarefa, Usuario } from '@/lib/data/types'
import { formatDateTimeLocalInputValue } from '@/lib/utils/date-time'

export default function TarefasPage() {
  const { state, lookups } = useCRM()
  const { appearance, general, formatDateTime, formatDate } = useAppSettings()
  const { user } = useSession()
  const hasTarefasAccess = hasModuleAccess(user, 'tarefas')
  const tarefas = state.tarefas
  const clientes = state.clientes
  const usuarios = state.usuarios

  const [showAddForm, setShowAddForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [dataHora, setDataHora] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [editingTarefaId, setEditingTarefaId] = useState<string | null>(null)
  const [editDescricao, setEditDescricao] = useState('')
  const [editDataHora, setEditDataHora] = useState('')
  const [editResponsavelId, setEditResponsavelId] = useState('')
  const [editClienteId, setEditClienteId] = useState('')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  const [isSavingTask, setIsSavingTask] = useState(false)

  const clienteSearchTerm = clienteSearch.trim().toLowerCase()

  const {
    tarefasHoje,
    tarefasAtrasadas,
    tarefasFuturas,
    tarefasPendentes,
    tarefasOrdenadasDesc,
    tarefasFuturasOrdenadas,
    tarefasPorDia,
    filteredClientes,
  } = useMemo(() => {
    const hoje = new Date()
    const fimDeHoje = new Date(hoje)
    fimDeHoje.setHours(23, 59, 59, 999)

    const hojeItems: Tarefa[] = []
    const atrasadasItems: Tarefa[] = []
    const futurasItems: Tarefa[] = []
    const pendentesItems: Tarefa[] = []
    const tarefasDiaMap = new Map<string, Tarefa[]>()

    for (const tarefa of tarefas) {
      const dataHora = new Date(tarefa.dataHora)

      if (tarefa.status === 'pendente') {
        pendentesItems.push(tarefa)
      }

      if (isSameDay(dataHora, hoje) && tarefa.status !== 'concluida') {
        hojeItems.push(tarefa)
      }

      if (dataHora < hoje && tarefa.status === 'pendente') {
        atrasadasItems.push(tarefa)
      }

      if (dataHora > fimDeHoje && tarefa.status !== 'concluida') {
        futurasItems.push(tarefa)
      }

      const dayKey = format(dataHora, 'yyyy-MM-dd')
      const grouped = tarefasDiaMap.get(dayKey)
      if (grouped) {
        grouped.push(tarefa)
      } else {
        tarefasDiaMap.set(dayKey, [tarefa])
      }
    }

    const orderedDesc = [...tarefas].sort(
      (a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime()
    )
    const futurasOrdenadas = [...futurasItems].sort(
      (a, b) => new Date(a.dataHora).getTime() - new Date(b.dataHora).getTime()
    )
    const clientesFiltrados = clienteSearchTerm
      ? clientes.filter((cliente: Cliente) => cliente.nome.toLowerCase().includes(clienteSearchTerm))
      : clientes

    return {
      tarefasHoje: hojeItems,
      tarefasAtrasadas: atrasadasItems,
      tarefasFuturas: futurasItems,
      tarefasPendentes: pendentesItems,
      tarefasOrdenadasDesc: orderedDesc,
      tarefasFuturasOrdenadas: futurasOrdenadas,
      tarefasPorDia: tarefasDiaMap,
      filteredClientes: clientesFiltrados,
    }
  }, [clienteSearchTerm, clientes, tarefas])

  const tarefasSelecionadas = useMemo(() => {
    if (!selectedDate) return []
    return tarefasPorDia.get(format(selectedDate, 'yyyy-MM-dd')) || []
  }, [selectedDate, tarefasPorDia])

  if (!hasTarefasAccess) {
    return <ModuleAccessState module="tarefas" />
  }

  const handleAddTarefa = async () => {
    if (isCreatingTask || !descricao.trim() || !dataHora || !responsavelId || !clienteId) return

    setIsCreatingTask(true)

    try {
      await createTarefa({
        clienteId,
        descricao,
        dataHora: new Date(dataHora),
        status: 'pendente',
        responsavelId,
      })

      setShowAddForm(false)
      setDescricao('')
      setDataHora('')
      setResponsavelId('')
      setClienteId('')
      toast.success('Tarefa criada com sucesso.')
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel criar a tarefa.')
    } finally {
      setIsCreatingTask(false)
    }
  }

  const openEditDialog = (tarefa: Tarefa) => {
    setEditingTarefaId(tarefa.id)
    setEditDescricao(tarefa.descricao)
    setEditDataHora(formatDateTimeLocalInputValue(tarefa.dataHora))
    setEditResponsavelId(tarefa.responsavelId)
    setEditClienteId(tarefa.clienteId)
    setShowEditForm(true)
  }

  const handleSaveEdit = async () => {
    if (isSavingTask || !editingTarefaId || !editDescricao.trim() || !editDataHora || !editResponsavelId || !editClienteId) return

    setIsSavingTask(true)

    try {
      await updateTarefa(editingTarefaId, {
        clienteId: editClienteId,
        descricao: editDescricao,
        titulo: editDescricao,
        dataHora: new Date(editDataHora),
        status: tarefas.find((tarefa: Tarefa) => tarefa.id === editingTarefaId)?.status || 'pendente',
        responsavelId: editResponsavelId,
      })

      setShowEditForm(false)
      setEditingTarefaId(null)
      toast.success('Tarefa atualizada com sucesso.')
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel salvar a tarefa.')
    } finally {
      setIsSavingTask(false)
    }
  }

  const getStatusColor = (tarefa: Tarefa) => {
    if (tarefa.status === 'concluida') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    if (new Date(tarefa.dataHora) < new Date() && tarefa.status === 'pendente') {
      return 'bg-red-500/20 text-red-400 border-red-500/30'
    }
    return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  }

  const getStatusLabel = (tarefa: Tarefa) => {
    if (tarefa.status === 'concluida') return 'Concluida'
    if (new Date(tarefa.dataHora) < new Date() && tarefa.status === 'pendente') return 'Atrasada'
    return 'Pendente'
  }

  const handleDelete = (id: string) => {
    if (!general.confirmDeletes || confirm('Tem certeza que deseja excluir esta tarefa?')) {
      void deleteTarefa(id)
        .then(() => {
          toast.success('Tarefa excluida com sucesso.')
        })
        .catch((error: any) => {
          toast.error(error?.message || 'Nao foi possivel excluir a tarefa.')
        })
    }
  }

  const renderTarefaItem = (tarefa: Tarefa) => {
    const cliente = lookups.clientesById.get(tarefa.clienteId)
    const responsavel = lookups.usuariosById.get(tarefa.responsavelId)
    const canEdit =
      user?.role === 'admin' ||
      user?.role === 'gerente' ||
      tarefa.responsavelId === user?.id

    return (
      <div key={tarefa.id} className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
        <Checkbox
          checked={tarefa.status === 'concluida'}
          onCheckedChange={(checked) => updateTarefaStatus(tarefa.id, checked ? 'concluida' : 'pendente')}
          className="mt-0.5 border-slate-500 data-[state=checked]:border-slate-700 data-[state=checked]:bg-slate-700"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-medium ${tarefa.status === 'concluida' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {tarefa.titulo || tarefa.descricao}
            </p>
            <Badge variant="outline" className={getStatusColor(tarefa)}>
              {getStatusLabel(tarefa)}
            </Badge>
          </div>
          {cliente && (
            <Link href={`/clientes/${cliente.id}`} className="text-sm text-primary hover:underline">
              {cliente.nome}
            </Link>
          )}
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {formatDateTime(tarefa.dataHora)}
            </span>
            {responsavel && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="w-3 h-3" />
                {responsavel.nome}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(tarefa)}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(tarefa.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  return (
    <>
      <CRMHeader
        title="Tarefas"
        subtitle="Gerencie suas tarefas e acompanhamentos"
        action={{ label: 'Nova Tarefa', onClick: () => setShowAddForm(true) }}
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Tabs defaultValue="hoje">
              <TabsList className="mb-4 flex flex-wrap h-auto">
                <TabsTrigger value="hoje">Hoje ({tarefasHoje.length})</TabsTrigger>
                <TabsTrigger value="atrasadas">Atrasadas ({tarefasAtrasadas.length})</TabsTrigger>
                <TabsTrigger value="futuras">Futuras ({tarefasFuturas.length})</TabsTrigger>
                <TabsTrigger value="pendentes">Pendentes ({tarefasPendentes.length})</TabsTrigger>
                <TabsTrigger value="todas">Todas ({tarefas.length})</TabsTrigger>
                {selectedDate && (
                  <TabsTrigger value="dia">
                    {formatDate(selectedDate)} ({tarefasSelecionadas.length})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="hoje">
                <Card className="bg-card border-border"><CardContent className="p-4">{tarefasHoje.length === 0 ? <p className="text-center text-muted-foreground py-8">Nenhuma tarefa para hoje</p> : <div className="space-y-3">{tarefasHoje.map(renderTarefaItem)}</div>}</CardContent></Card>
              </TabsContent>

              <TabsContent value="atrasadas">
                <Card className="bg-card border-border"><CardContent className="p-4">{tarefasAtrasadas.length === 0 ? <p className="text-center text-muted-foreground py-8">Nenhuma tarefa atrasada</p> : <div className="space-y-3">{tarefasAtrasadas.map(renderTarefaItem)}</div>}</CardContent></Card>
              </TabsContent>

              <TabsContent value="futuras">
                <Card className="bg-card border-border"><CardContent className="p-4">{tarefasFuturas.length === 0 ? <p className="text-center text-muted-foreground py-8">Nenhuma tarefa futura</p> : <div className="space-y-3">{tarefasFuturasOrdenadas.map(renderTarefaItem)}</div>}</CardContent></Card>
              </TabsContent>

              <TabsContent value="pendentes">
                <Card className="bg-card border-border"><CardContent className="p-4">{tarefasPendentes.length === 0 ? <p className="text-center text-muted-foreground py-8">Nenhuma tarefa pendente</p> : <div className="space-y-3">{tarefasPendentes.map(renderTarefaItem)}</div>}</CardContent></Card>
              </TabsContent>

              <TabsContent value="todas">
                <Card className="bg-card border-border"><CardContent className="p-4"><div className="space-y-3">{tarefasOrdenadasDesc.map(renderTarefaItem)}</div></CardContent></Card>
              </TabsContent>

              {selectedDate && (
                <TabsContent value="dia">
                  <Card className="bg-card border-border">
                    <CardContent className="p-4">
                      {tarefasSelecionadas.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">Nenhuma tarefa para {formatDate(selectedDate)}</p>
                      ) : (
                        <div className="space-y-3">{tarefasSelecionadas.map(renderTarefaItem)}</div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
            </Tabs>
          </div>

          <div>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Calendario</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[120px] text-center">
                      {currentMonth.toLocaleDateString(appearance.idioma, { month: 'long', year: 'numeric' })}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => (
                    <div key={index} className="text-center text-xs text-muted-foreground py-1">{day}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: monthStart.getDay() }).map((_, index) => <div key={`pad-${index}`} />)}

                  {days.map((day) => {
                    const tarefasDia = tarefasPorDia.get(format(day, 'yyyy-MM-dd')) || []
                    const hasAtrasadas = tarefasDia.some((tarefa: Tarefa) => tarefa.status === 'pendente' && new Date(tarefa.dataHora) < new Date())
                    const isSelected = selectedDate ? isSameDay(day, selectedDate) : false

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => setSelectedDate(isSelected ? null : day)}
                        className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm relative border transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : isToday(day)
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : tarefasDia.length > 0
                                ? 'bg-secondary border-border'
                                : 'border-transparent hover:bg-secondary/60'
                        }`}
                      >
                        {format(day, 'd')}
                        {tarefasDia.length > 0 && (
                          <div className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${hasAtrasadas ? 'bg-red-400' : 'bg-primary'}`} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Buscar cliente..."
                      value={clienteSearch}
                      onChange={(event) => setClienteSearch(event.target.value)}
                    />
                  </div>
                  {filteredClientes.map((cliente: Cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>{cliente.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descricao</Label>
              <Input placeholder="O que precisa ser feito?" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Data e Hora</Label>
              <Input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Responsavel</Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger><SelectValue placeholder="Selecione o responsavel" /></SelectTrigger>
                <SelectContent>
                  {usuarios
                    .filter((usuario: Usuario) => usuario.role !== 'admin')
                    .map((usuario: Usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>{usuario.nome}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)} disabled={isCreatingTask}>Cancelar</Button>
              <Button data-enter-confirm="true" onClick={() => void handleAddTarefa()} pending={isCreatingTask} disabled={isCreatingTask || !descricao.trim() || !dataHora || !responsavelId || !clienteId}>
                Criar Tarefa
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditForm} onOpenChange={setShowEditForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={editClienteId} onValueChange={setEditClienteId}>
                <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.map((cliente: Cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>{cliente.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descricao</Label>
              <Input value={editDescricao} onChange={(event) => setEditDescricao(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Data e Hora</Label>
              <Input type="datetime-local" value={editDataHora} onChange={(event) => setEditDataHora(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Responsavel</Label>
              <Select value={editResponsavelId} onValueChange={setEditResponsavelId}>
                <SelectTrigger><SelectValue placeholder="Selecione o responsavel" /></SelectTrigger>
                <SelectContent>
                  {usuarios
                    .filter((usuario: Usuario) => usuario.role !== 'admin')
                    .map((usuario: Usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>{usuario.nome}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowEditForm(false)} disabled={isSavingTask}>Cancelar</Button>
              <Button data-enter-confirm="true" onClick={() => void handleSaveEdit()} pending={isSavingTask} disabled={isSavingTask || !editDescricao.trim() || !editDataHora || !editResponsavelId || !editClienteId}>
                Salvar alteracoes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
