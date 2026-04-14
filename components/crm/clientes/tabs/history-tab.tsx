'use client'

import { useState } from 'react'
import { useAppSettings } from '@/lib/context/app-settings-context'
import { createInteracao, useInteracoes, useSession, useUsuarios } from '@/lib/hooks/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  FileText,
  ListTodo,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Repeat,
  Users,
} from 'lucide-react'
import { tipoInteracaoLabels, type Interacao, type TipoInteracao, type Usuario } from '@/lib/data/types'

interface HistoryTabProps {
  clienteId: string
}

const iconsByType: Record<TipoInteracao, typeof MessageCircle> = {
  ligacao: Phone,
  reuniao: Users,
  visita: MapPin,
  email: Mail,
  nota: FileText,
  mudanca_status: Repeat,
  proposta: FileText,
  tarefa: ListTodo,
}

const colorsByType: Record<TipoInteracao, string> = {
  ligacao: 'bg-blue-500/20 text-blue-400',
  reuniao: 'bg-indigo-500/20 text-indigo-400',
  visita: 'bg-purple-500/20 text-purple-400',
  email: 'bg-amber-500/20 text-amber-400',
  nota: 'bg-slate-500/20 text-slate-300',
  mudanca_status: 'bg-cyan-500/20 text-cyan-400',
  proposta: 'bg-emerald-500/20 text-emerald-400',
  tarefa: 'bg-orange-500/20 text-orange-400',
}

const FALLBACK_ICON = MessageCircle
const FALLBACK_COLOR = 'bg-slate-500/20 text-slate-300'
const FALLBACK_LABEL = 'Interacao'
const manualInteractionOptions = Object.entries(tipoInteracaoLabels).filter(
  ([value]) => value !== 'tarefa' && value !== 'proposta'
)

export function HistoryTab({ clienteId }: HistoryTabProps) {
  const { formatDateTime } = useAppSettings()
  const { user } = useSession()
  const { usuarios } = useUsuarios()
  const { interacoes, mutate, isLoading, error } = useInteracoes(clienteId)
  const [showAddForm, setShowAddForm] = useState(false)
  const [tipo, setTipo] = useState<TipoInteracao>('ligacao')
  const [descricao, setDescricao] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleAddInteracao = async () => {
    if (!descricao.trim() || !user?.id) {
      setSubmitError('Nao foi possivel identificar o usuario logado.')
      return
    }

    setSaving(true)
    setSubmitError('')

    try {
      await createInteracao({
        clienteId,
        tipo,
        descricao: descricao.trim(),
        usuarioId: user.id,
      })

      await mutate()
      setShowAddForm(false)
      setDescricao('')
      setTipo('ligacao')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao registrar interacao.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Historico de Interacoes</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Interacao
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-muted-foreground">Carregando historico...</p>
          ) : error ? (
            <p className="py-8 text-center text-destructive">Erro ao carregar historico de interacoes.</p>
          ) : interacoes.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhuma interacao registrada</p>
          ) : (
            <div className="relative">
              <div className="absolute bottom-0 left-5 top-0 w-px bg-border" />

              <div className="space-y-6">
                {interacoes.map((interacao: Interacao) => {
                  const Icon = iconsByType[interacao.tipo] || FALLBACK_ICON
                  const usuario = usuarios.find((item: Usuario) => item.id === interacao.usuarioId)
                  const colorClass = colorsByType[interacao.tipo] || FALLBACK_COLOR
                  const label = tipoInteracaoLabels[interacao.tipo] || FALLBACK_LABEL

                  return (
                    <div key={interacao.id} className="relative flex gap-4">
                      <div
                        className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ${colorClass}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 rounded-lg bg-secondary/50 p-4">
                        <div className="mb-2 flex items-start justify-between gap-4">
                          <span className="text-sm font-medium text-foreground">{label}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(interacao.criadoEm)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{interacao.descricao}</p>
                        {usuario && (
                          <p className="mt-2 text-xs text-muted-foreground">Por {usuario.nome}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Interacao</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Interacao</Label>
              <Select value={tipo} onValueChange={(value) => setTipo(value as TipoInteracao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {manualInteractionOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descricao</Label>
              <Textarea
                placeholder="Descreva a interacao..."
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
                rows={4}
              />
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddForm(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={() => void handleAddInteracao()} disabled={!descricao.trim() || saving}>
                {saving ? 'Registrando...' : 'Registrar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
