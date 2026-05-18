'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { hasRuleAccess } from '@/lib/auth/rule-access'
import { useCRM } from '@/lib/context/crm-context'
import { prefetchProposta, useProposta, useSession } from '@/lib/hooks/use-api'
import { statusPropostaLabels, type Proposta, type StatusProposta } from '@/lib/data/types'
import { parseProposalMaterialTags } from '@/lib/utils/proposal-material-tags'
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
import { cn } from '@/lib/utils'

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
  'pos_fechamento',
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

const workflowStatusOptionsByCurrentStatus: Partial<Record<StatusProposta, StatusProposta[]>> = {
  novo_cliente: ['novo_cliente', 'em_orcamento'],
  em_orcamento: ['em_orcamento', 'em_retificacao', 'aguardando_aprovacao'],
  em_retificacao: ['em_retificacao', 'em_orcamento', 'aguardando_aprovacao'],
  aguardando_aprovacao: ['aguardando_aprovacao', 'em_retificacao', 'enviar_ao_cliente'],
  enviar_ao_cliente: ['enviar_ao_cliente', 'em_orcamento', 'em_retificacao', 'aguardando_aprovacao', 'enviado_ao_cliente'],
  enviado_ao_cliente: ['enviado_ao_cliente', 'follow_up_1_dia', 'em_retificacao', 'fechado', 'perdido'],
  follow_up_1_dia: ['follow_up_1_dia', 'follow_up_3_dias', 'em_retificacao', 'fechado', 'perdido', 'stand_by'],
  follow_up_3_dias: ['follow_up_3_dias', 'follow_up_7_dias', 'em_retificacao', 'fechado', 'perdido', 'stand_by'],
  follow_up_7_dias: ['follow_up_7_dias', 'em_retificacao', 'fechado', 'perdido', 'stand_by'],
  stand_by: ['stand_by', 'enviado_ao_cliente', 'em_retificacao', 'fechado', 'perdido'],
  fechado: ['fechado', 'pos_fechamento', 'enviado_ao_cliente', 'em_retificacao'],
  pos_fechamento: ['pos_fechamento', 'fechado', 'enviado_ao_cliente', 'em_retificacao', 'perdido'],
  perdido: ['perdido', 'enviado_ao_cliente', 'em_retificacao'],
}

function RequiredLabel({ children }: { children: string }) {
  return (
    <span>
      {children} <span className="text-destructive">*</span>
    </span>
  )
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isPdfAttachment(anexo: { tipoMime?: string; nome?: string }) {
  return anexo.tipoMime === 'application/pdf' || String(anexo.nome || '').toLowerCase().endsWith('.pdf')
}

function parseProposalNumericInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatEditableProposalValue(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return ''
  }

  return String(value).replace('.', ',')
}

function readProposalString(
  proposta: (Partial<Proposta> & Record<string, unknown>) | null | undefined,
  camelKey: keyof Proposta,
  snakeKey?: string
) {
  const value = proposta?.[camelKey] ?? (snakeKey ? proposta?.[snakeKey] : undefined)
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function readProposalStatus(
  proposta: (Partial<Proposta> & Record<string, unknown>) | null | undefined,
  fallback: StatusProposta = 'novo_cliente'
): StatusProposta {
  const value = readProposalString(proposta, 'status')
  return visibleStatuses.includes(value as StatusProposta) ? (value as StatusProposta) : fallback
}

function readProposalNumber(
  proposta: (Partial<Proposta> & Record<string, unknown>) | null | undefined,
  key: keyof Proposta,
  snakeKey?: string
) {
  const value = proposta?.[key] ?? (snakeKey ? proposta?.[snakeKey] : undefined)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    return parseProposalNumericInput(value) ?? 0
  }

  return 0
}

function mergeProposalFormSnapshot(primary: Proposta, fallback: Proposta) {
  return {
    ...fallback,
    ...primary,
    clienteId:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'clienteId', 'cliente_id') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'clienteId', 'cliente_id'),
    clienteNome:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'clienteNome', 'cliente_nome') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'clienteNome', 'cliente_nome'),
    responsavelId:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'responsavelId', 'responsavel_id') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'responsavelId', 'responsavel_id'),
    orcamentistaId:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'orcamentistaId', 'orcamentista_id') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'orcamentistaId', 'orcamentista_id'),
    status: readProposalStatus(
      primary as Partial<Proposta> & Record<string, unknown>,
      readProposalStatus(fallback as Partial<Proposta> & Record<string, unknown>)
    ),
    materialTag:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'materialTag', 'material_tag') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'materialTag', 'material_tag') ||
      null,
    descricao:
      readProposalString(primary as Partial<Proposta> & Record<string, unknown>, 'descricao') ||
      readProposalString(fallback as Partial<Proposta> & Record<string, unknown>, 'descricao'),
    valor:
      readProposalNumber(primary as Partial<Proposta> & Record<string, unknown>, 'valor', 'valor_final') ||
      readProposalNumber(fallback as Partial<Proposta> & Record<string, unknown>, 'valor', 'valor_final'),
    anexos: primary.anexos ?? fallback.anexos,
    comentarios: primary.comentarios ?? fallback.comentarios,
  } satisfies Proposta
}

interface ProposalFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clienteIdInicial?: string
  propostaId?: string | null
  propostaInicial?: Proposta | null
}

export function ProposalFormDialog({
  open,
  onOpenChange,
  clienteIdInicial,
  propostaId,
  propostaInicial,
}: ProposalFormDialogProps) {
  const { state, lookups, addProposta, updateProposta } = useCRM()
  const { user } = useSession()
  const { proposta, isLoading } = useProposta(open && propostaId ? propostaId : null)
  const propostaSource = proposta && propostaInicial
    ? mergeProposalFormSnapshot(proposta, propostaInicial)
    : proposta || propostaInicial || null
  const isEditing = Boolean(propostaId)
  const isAdmin = user?.role === 'admin' || user?.role === 'gerente'
  const canSelectResponsavel = hasRuleAccess(user, 'canSelectProposalResponsavelOnForm')
  const canAssignOrcamentista = hasRuleAccess(user, 'canAssignProposalOrcamentistaOnForm')
  const canEditProposalDirectly = hasRuleAccess(user, 'canEditProposalDirectlyOutsideFunnel')
  const canEditStatusDirectly = hasRuleAccess(user, 'canEditProposalStatusDirectly')

  const [clienteId, setClienteId] = useState(clienteIdInicial || '')
  const [clienteSearch, setClienteSearch] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [orcamentistaId, setOrcamentistaId] = useState('')
  const [valor, setValor] = useState('')
  const [materialTag, setMaterialTag] = useState('')
  const [descricao, setDescricao] = useState('')
  const [status, setStatus] = useState<StatusProposta>('novo_cliente')
  const [files, setFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hydratedKeyRef = useRef<string | null>(null)
  const valueInputRef = useRef<HTMLInputElement | null>(null)
  const latestValorRef = useRef('')
  const isDirtyRef = useRef(false)
  const propostaHydrationKey = propostaSource
    ? [
        propostaSource.id,
        readProposalString(propostaSource as Partial<Proposta> & Record<string, unknown>, 'clienteId', 'cliente_id'),
        readProposalString(propostaSource as Partial<Proposta> & Record<string, unknown>, 'responsavelId', 'responsavel_id'),
        readProposalString(propostaSource as Partial<Proposta> & Record<string, unknown>, 'orcamentistaId', 'orcamentista_id'),
        readProposalNumber(propostaSource as Partial<Proposta> & Record<string, unknown>, 'valor', 'valor_final'),
        readProposalStatus(propostaSource as Partial<Proposta> & Record<string, unknown>),
        readProposalString(propostaSource as Partial<Proposta> & Record<string, unknown>, 'materialTag', 'material_tag'),
        readProposalString(propostaSource as Partial<Proposta> & Record<string, unknown>, 'descricao'),
      ].join(':')
    : null
  useEffect(() => {
    if (!open || !isEditing || !propostaInicial) {
      return
    }

    const initialHydrationKey = [
      propostaInicial.id,
      readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'clienteId', 'cliente_id'),
      readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'responsavelId', 'responsavel_id'),
      readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'orcamentistaId', 'orcamentista_id'),
      readProposalNumber(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'valor', 'valor_final'),
      readProposalStatus(propostaInicial as Partial<Proposta> & Record<string, unknown>),
      readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'materialTag', 'material_tag'),
      readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'descricao'),
    ].join(':')

    if (hydratedKeyRef.current === initialHydrationKey) {
      return
    }

    if (hydratedKeyRef.current !== null && isDirtyRef.current) {
      return
    }

    hydratedKeyRef.current = initialHydrationKey
    setClienteId(readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'clienteId', 'cliente_id'))
    setClienteSearch('')
    setResponsavelId(readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'responsavelId', 'responsavel_id'))
    setOrcamentistaId(readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'orcamentistaId', 'orcamentista_id'))
    const hydratedValor = formatEditableProposalValue(
      readProposalNumber(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'valor', 'valor_final')
    )
    latestValorRef.current = hydratedValor
    setValor(hydratedValor)
    setMaterialTag(readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'materialTag', 'material_tag'))
    setDescricao(readProposalString(propostaInicial as Partial<Proposta> & Record<string, unknown>, 'descricao'))
    setStatus(readProposalStatus(propostaInicial as Partial<Proposta> & Record<string, unknown>))
    setFiles([])
    isDirtyRef.current = false
  }, [isEditing, open, propostaInicial])
  useEffect(() => {
    if (!open) {
      hydratedKeyRef.current = null
      isDirtyRef.current = false
      return
    }

    if (propostaSource && isEditing) {
      if (hydratedKeyRef.current === propostaHydrationKey) {
        return
      }

      if (hydratedKeyRef.current !== null && isDirtyRef.current) {
        return
      }

      hydratedKeyRef.current = propostaHydrationKey
      const proposalRecord = propostaSource as Partial<Proposta> & Record<string, unknown>
      setClienteId(readProposalString(proposalRecord, 'clienteId', 'cliente_id'))
      setClienteSearch('')
      setResponsavelId(readProposalString(proposalRecord, 'responsavelId', 'responsavel_id'))
      setOrcamentistaId(readProposalString(proposalRecord, 'orcamentistaId', 'orcamentista_id'))
      const hydratedValor = formatEditableProposalValue(readProposalNumber(proposalRecord, 'valor', 'valor_final'))
      latestValorRef.current = hydratedValor
      setValor(hydratedValor)
      setMaterialTag(readProposalString(proposalRecord, 'materialTag', 'material_tag'))
      setDescricao(readProposalString(proposalRecord, 'descricao'))
      setStatus(readProposalStatus(proposalRecord))
      setFiles([])
      isDirtyRef.current = false
      return
    }

    if (isEditing) {
      return
    }

    const nextCreateKey = `create:${clienteIdInicial || ''}:${user?.id || ''}:${isAdmin ? 'admin' : 'user'}:${canSelectResponsavel ? 'responsavel' : 'responsavel-fixo'}:${canAssignOrcamentista ? 'orcamentista' : 'orcamentista-fixo'}`
    if (hydratedKeyRef.current !== null) {
      return
    }

    const clienteResponsavelInicial =
      state.clientes.find((cliente) => cliente.id === clienteIdInicial)?.responsavelId || ''

    hydratedKeyRef.current = nextCreateKey
    setClienteId(clienteIdInicial || '')
    setClienteSearch('')
    setResponsavelId(
      isAdmin
        ? ''
        : user?.role === 'orcamentista'
          ? clienteResponsavelInicial
          : user?.id || ''
    )
    setOrcamentistaId('')
    latestValorRef.current = ''
    setValor('')
    setMaterialTag('')
    setDescricao('')
    setStatus('novo_cliente')
    setFiles([])
    isDirtyRef.current = false
  }, [canAssignOrcamentista, canSelectResponsavel, clienteIdInicial, isAdmin, isEditing, open, propostaHydrationKey, propostaSource, state.clientes, user?.id, user?.role])

  useEffect(() => {
    latestValorRef.current = valor
  }, [valor])

  useEffect(() => {
    if (!open || isEditing || user?.role !== 'orcamentista' || !clienteId) {
      return
    }

    const clienteResponsavel = state.clientes.find((cliente) => cliente.id === clienteId)?.responsavelId || ''
    if (clienteResponsavel && !responsavelId) {
      setResponsavelId(clienteResponsavel)
    }
  }, [clienteId, isEditing, open, responsavelId, state.clientes, user?.role])

  const clientesFiltrados = useMemo(
    () =>
      state.clientes.filter((cliente) =>
        cliente.nome.toLowerCase().includes(clienteSearch.toLowerCase())
      ),
    [clienteSearch, state.clientes]
  )
  const currentClient = useMemo(
    () =>
      state.clientes.find((cliente) => cliente.id === clienteId) ||
      (clienteId
        ? {
            id: clienteId,
            nome:
              readProposalString(
                propostaSource as (Partial<Proposta> & Record<string, unknown>) | null,
                'clienteNome',
                'cliente_nome'
              ) || 'Cliente atual',
          }
        : null),
    [clienteId, propostaSource?.clienteNome, state.clientes]
  )
  const clientesSelectOptions = useMemo(() => {
    if (!currentClient) {
      return clientesFiltrados
    }

    const hasCurrentClient = clientesFiltrados.some((cliente) => cliente.id === currentClient.id)
    return hasCurrentClient ? clientesFiltrados : [currentClient, ...clientesFiltrados]
  }, [clientesFiltrados, currentClient])

  const responsaveis = state.usuarios.filter(
    (usuario) => usuario.ativo && (usuario.role === 'vendedor' || usuario.role === 'gerente')
  )
  const orcamentistas = state.usuarios.filter(
    (usuario) => usuario.ativo && usuario.role === 'orcamentista'
  )
  const currentWorkflowStatus = propostaSource
    ? readProposalStatus(propostaSource as Partial<Proposta> & Record<string, unknown>)
    : status

  const editStatusOptions = useMemo(() => {
    if (isAdmin) {
      const baseOptions = workflowStatusOptionsByCurrentStatus[currentWorkflowStatus] || [currentWorkflowStatus]
      if (user?.role === 'gerente' && currentWorkflowStatus === 'aguardando_aprovacao') {
        return baseOptions.filter((option) => option !== 'enviar_ao_cliente')
      }
      return baseOptions
    }
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
  }, [currentWorkflowStatus, isAdmin, user?.role])

  const valorObrigatorio = !statusesWithoutRequiredValue.includes(status)
  const orcamentistaObrigatorio =
    orcamentistas.length > 0 && statusesRequiringOrcamentista.includes(status)
  const parsedValor = parseProposalNumericInput(valor)
  const hasInvalidValue = valor.trim() !== '' && parsedValor === null
  const hasRequiredValue = !valorObrigatorio || (parsedValor ?? 0) > 0
  const requiresProposalPdf =
    status === 'aguardando_aprovacao' &&
    (!isEditing || propostaSource?.status !== 'aguardando_aprovacao')
  const hasExistingProposalPdf = Boolean(propostaSource?.anexos?.some(isPdfAttachment))
  const hasNewProposalPdf = files.some(isPdfFile)
  const hasRequiredProposalPdf = !requiresProposalPdf || hasExistingProposalPdf || hasNewProposalPdf
  const buildAttachmentHref = (attachmentId: string) =>
    propostaId ? `/api/propostas/${propostaId}/anexos/${attachmentId}` : '#'
  const materialTags = useMemo(() => parseProposalMaterialTags(materialTag), [materialTag])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const submittedForm = new FormData(event.currentTarget)
    const submittedValor = submittedForm.get('valor')
    const rawValor =
      (typeof submittedValor === 'string' ? submittedValor : '') ||
      latestValorRef.current ||
      valueInputRef.current?.value ||
      valor
    const parsedSubmitValue = parseProposalNumericInput(rawValor)
    const submitHasInvalidValue = rawValor.trim() !== '' && parsedSubmitValue === null
    const submitHasRequiredValue = !valorObrigatorio || (parsedSubmitValue ?? 0) > 0

    if (isSubmitting) return
    if (submitHasInvalidValue) {
      toast.error('Informe um valor valido para a proposta.')
      return
    }
    if (isEditing && !canEditProposalDirectly) {
      toast.error('Vendedores nao podem editar propostas fora do fluxo do funil.')
      return
    }
    if (!clienteId) {
      toast.error('Selecione um cliente para continuar.')
      return
    }
    if (canSelectResponsavel && !responsavelId && isAdmin) {
      toast.error('Selecione um vendedor responsavel para a proposta.')
      return
    }
    if (canAssignOrcamentista && orcamentistaObrigatorio && !orcamentistaId) {
      toast.error('Selecione um orcamentista para seguir com esta proposta.')
      return
    }
    if (!submitHasRequiredValue) {
      toast.error('Informe o valor do orcamento antes de avancar esta proposta.')
      return
    }

    if (!hasRequiredProposalPdf) {
      toast.error('Anexe obrigatoriamente a proposta em PDF antes de enviar para aprovacao.')
      return
    }

    const clienteResponsavelSelecionado =
      state.clientes.find((cliente) => cliente.id === clienteId)?.responsavelId || ''

    const payload = {
      clienteId,
      valor: rawValor.trim() ? rawValor : null,
      descricao,
      materialTag,
      status,
      responsavelId: isAdmin
        ? responsavelId
        : user?.role === 'orcamentista'
          ? responsavelId || clienteResponsavelSelecionado || propostaSource?.responsavelId || ''
          : user?.id,
      ...(canAssignOrcamentista
        ? isEditing
          ? (orcamentistaId ? { orcamentistaId } : {})
          : { orcamentistaId: orcamentistaId || null }
        : {}),
      anexos: files,
      dataEnvio: new Date(),
      criadoEm: proposta?.criadoEm || new Date(),
      titulo: proposta?.titulo || 'Proposta Comercial',
    }

    setIsSubmitting(true)

    try {
      if (isEditing && propostaId) {
        const updatedProposal = await updateProposta({
          id: propostaId,
          ...payload,
        } as unknown as Proposta)
        await prefetchProposta(String((updatedProposal as Proposta | undefined)?.id || propostaId))
        toast.success('Proposta atualizada com sucesso.')
      } else {
        const createdProposal = await addProposta(payload as unknown as Omit<Proposta, 'id' | 'criadoEm'>)
        const createdProposalId = String((createdProposal as Proposta | undefined)?.id || '')
        if (createdProposalId) {
          await prefetchProposta(createdProposalId)
        }
        toast.success('Proposta criada com sucesso.')
      }

      onOpenChange(false)
    } catch (error: any) {
      toast.error(error?.message || 'Nao foi possivel salvar a proposta.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] overflow-y-auto px-4 sm:w-full sm:max-w-5xl sm:px-6">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar proposta' : 'Nova proposta'}</DialogTitle>
          <DialogDescription>Campos com * sao obrigatorios.</DialogDescription>
        </DialogHeader>

        {isEditing && isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Carregando proposta...</p>
        ) : (
          <form className="space-y-4 py-1 sm:space-y-6" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-4 xl:grid-cols-[1.25fr_0.9fr] xl:gap-6">
              <div className="space-y-4 sm:space-y-6">
                <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Dados comerciais</h3>
                    <p className="text-sm text-muted-foreground">
                      Defina cliente, responsaveis e etapa atual da proposta.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 md:gap-5">
                    <div className="space-y-2">
                <Label><RequiredLabel>Cliente</RequiredLabel></Label>
                <Select value={clienteId} onValueChange={(value) => {
                  isDirtyRef.current = true
                  setClienteId(value)
                }}>
                  <SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:pr-6">
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
                    {clientesSelectOptions.map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id}>
                        {cliente.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canSelectResponsavel && (
                <div className="space-y-2">
                  <Label><RequiredLabel>Vendedor responsavel</RequiredLabel></Label>
                  <Select value={responsavelId} onValueChange={(value) => {
                     isDirtyRef.current = true
                     setResponsavelId(value)
                   }}>
                    <SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:pr-6">
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
                {canAssignOrcamentista ? (
                  <Select value={orcamentistaId || 'nao_definido'} onValueChange={(value) => {
                    isDirtyRef.current = true
                    setOrcamentistaId(value === 'nao_definido' ? '' : value)
                  }}>
                    <SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:pr-6">
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
                ) : (
                  <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground">
                    {propostaSource?.orcamentistaNome || user?.nome || 'Nao definido'}
                  </div>
                )}
              </div>

                    <div className="space-y-2">
                <Label>{valorObrigatorio ? <RequiredLabel>Valor do orçamento</RequiredLabel> : 'Valor do orçamento'}</Label>
                <input
                  ref={valueInputRef}
                  name="valor"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valor}
                  onChange={(event) => {
                    isDirtyRef.current = true
                    latestValorRef.current = event.target.value
                    setValor(event.target.value)
                  }}
                  className={cn(
                    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
                    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {valorObrigatorio
                    ? 'O valor passa a ser obrigatorio a partir do momento em que o orçamento segue para aguardando aprovacao.'
                    : 'Neste momento o valor ainda pode ficar em branco.'}
                </p>
              </div>

                    <div className="space-y-2 md:col-span-2">
                <Label>{isEditing ? <RequiredLabel>Status</RequiredLabel> : 'Status inicial'}</Label>
                {canEditStatusDirectly ? (
                  <Select value={status} onValueChange={(value) => {
                     isDirtyRef.current = true
                     setStatus(value as StatusProposta)
                   }}>
                    <SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:pr-6">
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
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {statusPropostaLabels[status]}
                  </div>
                )}
                {!canEditStatusDirectly && isEditing ? (
                  <p className="text-xs text-muted-foreground">
                    Para vendedores, a mudanca de status acontece diretamente no funil de vendas.
                  </p>
                ) : null}
              </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>Tag de material</Label>
                      <Input
                        placeholder="Ex.: Vidro temperado, aluminio premium, ACM preto"
                        value={materialTag}
                        maxLength={80}
                        onChange={(event) => {
                          isDirtyRef.current = true
                          setMaterialTag(event.target.value)
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Classifique o tipo de material principal desta proposta. Separe varias tags por virgula.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
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
                  onChange={(event) => {
                    isDirtyRef.current = true
                    setDescricao(event.target.value)
                  }}
                />
              </div>
                </div>
              </div>

              <div className="space-y-4 sm:space-y-6">
                <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Anexos do orcamento</h3>
                    <p className="text-sm text-muted-foreground">
                      Adicione arquivos da proposta. O historico completo fica disponivel nos detalhes.
                    </p>
                  </div>
                  <div className="space-y-3">
                <Label>{requiresProposalPdf ? <RequiredLabel>Proposta em PDF</RequiredLabel> : 'Proposta em PDF'}</Label>
                <div className="rounded-lg border border-dashed border-border bg-background/40 p-4">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    <span>
                      {requiresProposalPdf
                        ? 'Ao enviar para aguardando aprovacao, anexe obrigatoriamente a proposta em PDF.'
                        : 'Adicione o arquivo da proposta em PDF pelo gerenciador de arquivos do dispositivo.'}
                    </span>
                  </div>
                  <Input
                    className="mt-3"
                    type="file"
                    multiple
                    accept=".pdf,application/pdf"
                    onChange={(event) =>
                      {
                        isDirtyRef.current = true
                        setFiles(Array.from(event.target.files || []))
                      }
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
                    {isEditing && propostaSource?.anexos?.length ? (
                      <div className="mt-4 space-y-2 border-t border-border pt-3">
                        <p className="text-sm font-medium text-foreground">Arquivos ja enviados</p>
                      {propostaSource.anexos.map((anexo) => (
                        <a
                          key={anexo.id}
                          href={buildAttachmentHref(anexo.id)}
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

                <div className="rounded-xl border border-border bg-secondary/20 p-4 sm:p-6">
                  <h3 className="text-sm font-semibold text-foreground">Resumo rapido</h3>
                  <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-start justify-between gap-3">
                      <span>Cliente</span>
                      <span className="max-w-[14rem] text-right font-medium leading-snug break-words text-foreground">
                        {lookups.clientesById.get(clienteId)?.nome ||
                          currentClient?.nome ||
                          'Nao selecionado'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Status</span>
                      <span className="text-right font-medium text-foreground">{statusPropostaLabels[status]}</span>
                    </div>
                    {materialTags.length ? (
                      <div className="flex items-start justify-between gap-3">
                        <span>Material</span>
                        <div className="flex max-w-[14rem] flex-wrap justify-end gap-1.5">
                          {materialTags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <span>Valor</span>
                      <span className="text-right font-medium text-foreground">{valor || '0,00'}</span>
                    </div>
                    {requiresProposalPdf ? (
                      <div className="rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-foreground">
                        PDF obrigatorio para enviar esta proposta para aguardando aprovacao.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button
                type="submit"
                pending={isSubmitting}
                disabled={
                  isSubmitting ||
                  !clienteId ||
                  (isAdmin && !responsavelId) ||
                  (orcamentistaObrigatorio && !orcamentistaId) ||
                  hasInvalidValue ||
                  !hasRequiredValue ||
                  !hasRequiredProposalPdf
                }
              >
                {isEditing ? 'Salvar proposta' : 'Criar proposta'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
