'use client'

import { startTransition, useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
import { Clock, Plus, Trash2, Pencil } from 'lucide-react'
import { statusTarefaLabels } from '@/lib/data/types'
import { formatDateTimeLocalInputValue } from '@/lib/utils/date-time'

interface TasksTabProps {
  clienteId: string
}

export function TasksTab({ clienteId }: TasksTabProps) {
  const { general, formatDateTime } = useAppSettings()
  const { user } = useSession()
  const {
    getTarefasByCliente,
    addTarefa,
    updateTarefa,
    updateTarefaStatus,
    deleteTarefa,
    getUsuario,
    state,
  } = useCRM()

  const [showAddForm, setShowAddForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [dataHora, setDataHora] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [editingTarefaId, setEditingTarefaId] = useState<string | null>(null)
  const [editDescricao, setEditDescricao] = useState('')
  const [editDataHora, setEditDataHora] = useState('')
  const [editResponsavelId, setEditResponsavelId] = useState('')
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  const [isSavingTask, setIsSavingTask] = useState(false)

  const tarefas = getTarefasByCliente(clienteId)
  const canViewAllTasks = user?.role === 'admin' || user?.role === 'gerente'
  const visibleTarefas = canViewAllTasks
    ? tarefas
    : tarefas.filter((tarefa) => tarefa.responsavelId === user?.id)

  const handleAddTarefa = async () => {
    if (isCreatingTask || !descricao.trim() || !dataHora || !responsavelId) return

    setIsCreatingTask(true)

    try {
      await addTarefa({
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
      toast.success('Tarefa criada com sucesso.')
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel salvar a tarefa.')
    } finally {
      setIsCreatingTask(false)
    }
  }

  const openEditDialog = (tarefa: typeof visibleTarefas[number]) => {
    setEditingTarefaId(tarefa.id)
    setEditDescricao(tarefa.descricao)
    setEditDataHora(formatDateTimeLocalInputValue(tarefa.dataHora))
    setEditResponsavelId(tarefa.responsavelId)
    setShowEditForm(true)
  }

  const handleSaveEdit = async () => {
    if (isSavingTask || !editingTarefaId || !editDescricao.trim() || !editDataHora || !editResponsavelId) return

    setIsSavingTask(true)

    try {
      await updateTarefa({
        ...(visibleTarefas.find((tarefa) => tarefa.id === editingTarefaId) as typeof visibleTarefas[number]),
        descricao: editDescricao,
        titulo: editDescricao,
        dataHora: new Date(editDataHora),
        responsavelId: editResponsavelId,
      })

      startTransition(() => {
        setShowEditForm(false)
        setEditingTarefaId(null)
      })
      toast.success('Tarefa atualizada com sucesso.')
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel salvar a tarefa.')
    } finally {
      setIsSavingTask(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pendente':
        return 'border-amber-500/30 bg-amber-500/20 text-amber-400'
      case 'concluida':
        return 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400'
      case 'atrasada':
        return 'border-red-500/30 bg-red-500/20 text-red-400'
      default:
        return ''
    }
  }

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Tarefas</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Tarefa
          </Button>
        </CardHeader>
        <CardContent>
          {visibleTarefas.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Nenhuma tarefa registrada
            </p>
          ) : (
            <div className="space-y-3">
              {visibleTarefas.map((tarefa) => {
                const responsavel = getUsuario(tarefa.responsavelId)
                const isAtrasada =
                  tarefa.status === 'pendente' &&
                  new Date(tarefa.dataHora) < new Date()
                const canEdit = user?.role === 'admin' || tarefa.responsavelId === user?.id

                return (
                  <div
                    key={tarefa.id}
                    className="flex items-start gap-3 rounded-lg bg-secondary/50 p-4"
                  >
                    <Checkbox
                      checked={tarefa.status === 'concluida'}
                      onCheckedChange={(checked) =>
                        updateTarefaStatus(
                          tarefa.id,
                          checked ? 'concluida' : 'pendente'
                        )
                      }
                      className="mt-0.5 border-slate-500 data-[state=checked]:border-slate-700 data-[state=checked]:bg-slate-700"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm font-medium ${
                            tarefa.status === 'concluida'
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground'
                          }`}
                        >
                          {tarefa.titulo || tarefa.descricao}
                        </p>
                        <Badge
                          variant="outline"
                          className={getStatusColor(
                            isAtrasada ? 'atrasada' : tarefa.status
                          )}
                        >
                          {isAtrasada
                            ? 'Atrasada'
                            : statusTarefaLabels[tarefa.status]}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-4">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(tarefa.dataHora)}
                        </span>
                        {responsavel && (
                          <span className="text-xs text-muted-foreground">
                            {responsavel.nome}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDialog(tarefa)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            !general.confirmDeletes ||
                            confirm('Tem certeza que deseja excluir esta tarefa?')
                          ) {
                            void deleteTarefa(tarefa.id)
                              .then(() => {
                                toast.success('Tarefa excluida com sucesso.')
                              })
                              .catch((error: any) => {
                                toast.error(error?.message || 'Nao foi possivel excluir a tarefa.')
                              })
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Descricao</Label>
              <Input
                placeholder="O que precisa ser feito?"
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Data e Hora</Label>
              <Input
                type="datetime-local"
                value={dataHora}
                onChange={(event) => setDataHora(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Responsavel</Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o responsavel" />
                </SelectTrigger>
                <SelectContent>
                  {state.usuarios
                    .filter((usuario) => usuario.role !== 'admin')
                    .map((usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>
                        {usuario.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)} disabled={isCreatingTask}>
                Cancelar
              </Button>
              <Button
                onClick={() => void handleAddTarefa()}
                pending={isCreatingTask}
                disabled={isCreatingTask || !descricao.trim() || !dataHora || !responsavelId}
              >
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
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o responsavel" />
                </SelectTrigger>
                <SelectContent>
                  {state.usuarios
                    .filter((usuario) => usuario.role !== 'admin')
                    .map((usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>
                        {usuario.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowEditForm(false)} disabled={isSavingTask}>
                Cancelar
              </Button>
              <Button onClick={() => void handleSaveEdit()} pending={isSavingTask} disabled={isSavingTask || !editDescricao.trim() || !editDataHora || !editResponsavelId}>
                Salvar alteracoes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
