'use client'

import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useCRM } from '@/lib/context/crm-context'
import { useProposta, useSession } from '@/lib/hooks/use-api'
import { statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const visibleStatuses: StatusProposta[] = [
  'novo_cliente',
  'em_orcamento',
  'em_retificacao',
  'aguardando_aprovacao',
  'enviar_ao_cliente',
  'enviado_ao_cliente',
  'follow_up_1_dia',
  'follow_up_3_dias',
  'follow_up_7_dias',
  'stand_by',
  'fechado',
  'perdido',
]

const statusesWithoutRequiredValue: StatusProposta[] = [
  'novo_cliente',
  'em_orcamento',
  'em_retificacao',
]

const statusesRequiringOrcamentista: StatusProposta[] = [
  'em_orcamento',
  'em_retificacao',
  'aguardando_aprovacao',
]

function RequiredLabel({ children }: { children: string }) {
  return (
    <span>
      {children} <span className="text-destructive">*</span>
    </span>
  )
}

interface ProposalFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clienteIdInicial?: string
  propostaId?: string | null
}

export function ProposalFormDialog({
  open,
  onOpenChange,
  clienteIdInicial,
  propostaId,
}: ProposalFormDialogProps) {
  const { state, lookups, addProposta, updateProposta } = useCRM()
  const { user } = useSession()
  const { proposta, isLoading } = useProposta(open && propostaId ? propostaId : null)
  const isEditing = Boolean(propostaId)
  const isAdmin = user?.role === 'admin' || user?.role === 'gerente'

  const [clienteId, setClienteId] = useState(clienteIdInicial || '')
  const [clienteSearch, setClienteSearch] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [orcamentistaId, setOrcamentistaId] = useState('')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [status, setStatus] = useState<StatusProposta>('novo_cliente')
  const [files, setFiles] = useState<File[]>([])
  const hydratedKeyRef = useRef<string | null>(null)
  const propostaHydrationKey = proposta
    ? [
        proposta.id,
        proposta.clienteId,
        proposta.responsavelId,
        proposta.orcamentistaId,
        proposta.valor,
        proposta.status,
        proposta.descricao || '',
      ].join(':')
    : null

  useEffect(() => {
    if (!open) {
      hydratedKeyRef.current = null
      return
    }

    if (proposta && isEditing) {
      if (hydratedKeyRef.current === propostaHydrationKey) {
        return
      }

      hydratedKeyRef.current = propostaHydrationKey
      setClienteId(proposta.clienteId)
      setClienteSearch('')
      setResponsavelId(proposta.responsavelId || '')
      setOrcamentistaId(proposta.orcamentistaId || '')
      setValor(String(proposta.valor || ''))
      setDescricao(proposta.descricao || '')
      setStatus(proposta.status)
      setFiles([])
      return
    }

    const nextCreateKey = `create:${clienteIdInicial || ''}:${user?.id || ''}:${isAdmin ? 'admin' : 'user'}`
    if (hydratedKeyRef.current === nextCreateKey) {
      return
    }

    hydratedKeyRef.current = nextCreateKey
    setClienteId(clienteIdInicial || '')
    setClienteSearch('')
    setResponsavelId(isAdmin ? '' : user?.id || '')
    setOrcamentistaId('')
    setValor('')
    setDescricao('')
    setStatus('novo_cliente')
    setFiles([])
  }, [clienteIdInicial, isAdmin, isEditing, open, proposta, propostaHydrationKey, user?.id])

  const clientesFiltrados = useMemo(
    () =>
      state.clientes.filter((cliente) =>
        cliente.nome.toLowerCase().includes(clienteSearch.toLowerCase())
      ),
    [clienteSearch, state.clientes]
  )

  const responsaveis = state.usuarios.filter(
    (usuario) => usuario.ativo && (usuario.role === 'vendedor' || usuario.role === 'gerente')
  )
  const orcamentistas = state.usuarios.filter(
    (usuario) => usuario.ativo && usuario.role === 'orcamentista'
  )

  const editStatusOptions = useMemo(() => {
    if (isAdmin) return visibleStatuses
    if (user?.role === 'orcamentista') {
      return ['novo_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao'] as StatusProposta[]
    }
    return [
      'enviar_ao_cliente',
      'enviado_ao_cliente',
      'follow_up_1_dia',
      'follow_up_3_dias',
      'follow_up_7_dias',
      'stand_by',
      'em_retificacao',
      'fechado',
      'perdido',
    ] as StatusProposta[]
  }, [isAdmin, user?.role])

  const valorObrigatorio = !statusesWithoutRequiredValue.includes(status)
  const orcamentistaObrigatorio =
    orcamentistas.length > 0 && statusesRequiringOrcamentista.includes(status)
  const valorNumerico = Number(valor || 0)
  const hasRequiredValue = !valorObrigatorio || valorNumerico > 0

  const handleSubmit = () => {
    if (!clienteId || (!responsavelId && isAdmin) || (orcamentistaObrigatorio && !orcamentistaId) || !hasRequiredValue) {
      return
    }

    const payload = {
      clienteId,
      valor: valorNumerico,
      descricao,
      status,
      responsavelId: isAdmin ? responsavelId : user?.id,
      orcamentistaId: orcamentistaId || null,
      anexos: files,
      dataEnvio: new Date(),
      criadoEm: proposta?.criadoEm || new Date(),
      titulo: proposta?.titulo || 'Proposta Comercial',
    }

    startTransition(() => onOpenChange(false))

    const savePromise =
      isEditing && propostaId
        ? updateProposta({
            id: propostaId,
            ...payload,
          } as unknown as Proposta)
        : addProposta(payload as unknown as Omit<Proposta, 'id' | 'criadoEm'>)

    void savePromise.catch((error: any) => {
      toast.error(error?.message || 'Nao foi possivel salvar a proposta.')
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto px-6 sm:max-w-5xl sm:px-8">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar proposta' : 'Nova proposta'}</DialogTitle>
          <DialogDescription>Campos com * sao obrigatorios.</DialogDescription>
        </DialogHeader>

        {isEditing && isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Carregando proposta...</p>
        ) : (
          <div className="space-y-6 py-1">
            <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
              <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Dados comerciais</h3>
                    <p className="text-sm text-muted-foreground">
                      Defina cliente, responsaveis e etapa atual da proposta.
                    </p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                <Label><RequiredLabel>Cliente</RequiredLabel></Label>
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
                    {clientesFiltrados.map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id}>
                        {cliente.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <div className="space-y-2">
                  <Label><RequiredLabel>Vendedor responsavel</RequiredLabel></Label>
                  <Select value={responsavelId} onValueChange={setResponsavelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o vendedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {responsaveis.map((usuario) => (
                        <SelectItem key={usuario.id} value={usuario.id}>
                          {usuario.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

                    <div className="space-y-2">
                <Label>{orcamentistaObrigatorio ? <RequiredLabel>Orcamentista</RequiredLabel> : 'Orcamentista'}</Label>
                <Select value={orcamentistaId || 'nao_definido'} onValueChange={(value) => setOrcamentistaId(value === 'nao_definido' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o orcamentista" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao_definido">Nao definido</SelectItem>
                    {orcamentistas.map((usuario) => (
                      <SelectItem key={usuario.id} value={usuario.id}>
                        {usuario.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

                    <div className="space-y-2">
                <Label>{valorObrigatorio ? <RequiredLabel>Valor do orçamento</RequiredLabel> : 'Valor do orçamento'}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  value={valor}
                  onChange={(event) => setValor(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {valorObrigatorio
                    ? 'O valor passa a ser obrigatorio a partir do momento em que o orçamento segue para aguardando aprovacao.'
                    : 'Neste momento o valor ainda pode ficar em branco.'}
                </p>
              </div>

                    <div className="space-y-2 md:col-span-2">
                <Label>{isEditing ? <RequiredLabel>Status</RequiredLabel> : 'Status inicial'}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as StatusProposta)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(isEditing ? editStatusOptions : (['novo_cliente'] as StatusProposta[])).map((statusOption) => (
                      <SelectItem key={statusOption} value={statusOption}>
                        {statusPropostaLabels[statusOption]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Detalhes da proposta</h3>
                    <p className="text-sm text-muted-foreground">
                      Use a descricao para contexto comercial ou tecnico que ajude na negociacao.
                    </p>
                  </div>
                  <div className="space-y-2">
                <Label>Descricao</Label>
                <Textarea
                  rows={6}
                  placeholder="Detalhes opcionais da proposta"
                  value={descricao}
                  onChange={(event) => setDescricao(event.target.value)}
                />
              </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Anexos do orcamento</h3>
                    <p className="text-sm text-muted-foreground">
                      Adicione arquivos da proposta. O historico completo fica disponivel nos detalhes.
                    </p>
                  </div>
                  <div className="space-y-3">
                <Label>Anexos do orcamento</Label>
                <div className="rounded-lg border border-dashed border-border bg-background/40 p-4">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    <span>Adicione um ou mais arquivos de qualquer tipo.</span>
                  </div>
                  <Input
                    className="mt-3"
                    type="file"
                    multiple
                    onChange={(event) =>
                      setFiles(Array.from(event.target.files || []))
                    }
                  />
                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {files.map((file) => (
                        <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-sm text-foreground">
                          <Paperclip className="h-4 w-4 text-muted-foreground" />
                          <span>{file.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {isEditing && proposta?.anexos?.length ? (
                    <div className="mt-4 space-y-2 border-t border-border pt-3">
                      <p className="text-sm font-medium text-foreground">Arquivos ja enviados</p>
                      {proposta.anexos.map((anexo) => (
                        <a
                          key={anexo.id}
                          href={anexo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                          <Paperclip className="h-4 w-4" />
                          {anexo.nome}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
                </div>

                <div className="rounded-xl border border-border bg-secondary/20 p-6">
                  <h3 className="text-sm font-semibold text-foreground">Resumo rapido</h3>
                  <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Cliente</span>
                      <span className="font-medium text-foreground">
                        {lookups.clientesById.get(clienteId)?.nome || 'Nao selecionado'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Status</span>
                      <span className="font-medium text-foreground">{statusPropostaLabels[status]}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Valor</span>
                      <span className="font-medium text-foreground">{valor || '0,00'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Anexos novos</span>
                      <span className="font-medium text-foreground">{files.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={!clienteId || (isAdmin && !responsavelId) || (orcamentistaObrigatorio && !orcamentistaId) || !hasRequiredValue}
              >
                {isEditing ? 'Salvar proposta' : 'Criar proposta'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
