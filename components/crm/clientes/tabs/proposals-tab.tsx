'use client'

import { useState } from 'react'
import { useCRM } from '@/lib/context/crm-context'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { useSession } from '@/lib/hooks/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Plus, FileText, Calendar } from 'lucide-react'
import {
  statusPropostaColors,
  statusPropostaLabels,
  type StatusProposta,
} from '@/lib/data/types'

interface ProposalsTabProps {
  clienteId: string
}

const openStatuses: StatusProposta[] = [
  'em_cotacao',
  'enviado_ao_cliente',
  'em_negociacao',
  'em_retificacao',
]

export function ProposalsTab({ clienteId }: ProposalsTabProps) {
  const { formatCurrency, formatDate } = useAppSettings()
  const { getPropostasByCliente, addProposta, updateProposta, state } = useCRM()
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'

  const [showAddForm, setShowAddForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [status, setStatus] = useState<StatusProposta>('em_cotacao')
  const [editingPropostaId, setEditingPropostaId] = useState<string | null>(null)
  const [editValor, setEditValor] = useState('')
  const [editDescricao, setEditDescricao] = useState('')
  const [editStatus, setEditStatus] = useState<StatusProposta>('em_cotacao')

  const propostas = getPropostasByCliente(clienteId)

  const handleAddProposta = async () => {
    if (!valor || !descricao.trim() || (isAdmin && !responsavelId)) return

    await addProposta({
      clienteId,
      valor: Number(valor),
      descricao,
      status,
      dataEnvio: new Date(),
      responsavelId: isAdmin ? responsavelId : user?.id,
    })

    setShowAddForm(false)
    setValor('')
    setDescricao('')
    setResponsavelId('')
    setStatus('em_cotacao')
  }

  const responsaveisDisponiveis = state.usuarios.filter(
    (usuario) => usuario.ativo && usuario.role !== 'admin'
  )

  const openEditDialog = (proposta: typeof propostas[number]) => {
    setEditingPropostaId(proposta.id)
    setEditValor(String(proposta.valor))
    setEditDescricao(proposta.descricao)
    setEditStatus(proposta.status)
    setShowEditForm(true)
  }

  const handleSaveEdit = async () => {
    if (!editingPropostaId || !editValor || !editDescricao.trim()) return

    await updateProposta({
      id: editingPropostaId,
      clienteId,
      valor: Number(editValor),
      descricao: editDescricao,
      status: editStatus,
      dataEnvio: new Date(),
      criadoEm: new Date(),
    })

    setShowEditForm(false)
    setEditingPropostaId(null)
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Propostas</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Proposta
          </Button>
        </CardHeader>
        <CardContent>
          {propostas.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhuma proposta registrada</p>
          ) : (
            <div className="space-y-4">
              {propostas.map((proposta) => (
                <div
                  key={proposta.id}
                  className="rounded-lg border border-border bg-secondary/30 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary/20 p-2">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-foreground">
                          {formatCurrency(proposta.valor)}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          Atualizada em {formatDate(proposta.dataEnvio)}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusPropostaColors[proposta.status]}>
                      {statusPropostaLabels[proposta.status]}
                    </Badge>
                  </div>

                  <p className="mb-4 text-sm text-muted-foreground">{proposta.descricao}</p>

                  {(user?.role === 'admin' || proposta.responsavelId === user?.id) && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEditDialog(proposta)}>
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Proposta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Status inicial</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as StatusProposta)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {openStatuses.map((item) => (
                    <SelectItem key={item} value={item}>
                      {statusPropostaLabels[item]}
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
                disabled={!valor || !descricao.trim() || (isAdmin && !responsavelId)}
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
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={(value) => setEditStatus(value as StatusProposta)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusPropostaLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
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
              <Button onClick={() => void handleSaveEdit()} disabled={!editValor || !editDescricao.trim()}>
                Salvar alteracoes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
