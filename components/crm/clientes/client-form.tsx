'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { useCRM } from '@/lib/context/crm-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import type { Cliente } from '@/lib/data/types'
import { formatCep, useCepLookup } from '@/lib/hooks/use-cep-lookup'
import { formatBrazilPhone, isValidBrazilPhone } from '@/lib/utils/phone'
import {
  formatClientDocument,
  getClientDocumentLabel,
  getClientDocumentPlaceholder,
  getClientDocumentValidationMessage,
  isValidClientDocument,
} from '@/lib/utils/client-document'

function getClientFormDefaults(cliente?: Cliente) {
  if (cliente) {
      return {
        nome: cliente.nome,
        cpf: formatClientDocument(cliente.cpf || '', cliente.tipo),
        telefone: formatBrazilPhone(cliente.telefone || ''),
        email: cliente.email || '',
        empresa: cliente.empresa || '',
      cargo: cliente.cargo || '',
      endereco: cliente.endereco || '',
      numero: cliente.numero || '',
      bairro: cliente.bairro || '',
      cidade: cliente.cidade || '',
      estado: cliente.estado || '',
      cep: formatCep(cliente.cep || ''),
      tipo: cliente.tipo,
      origem: normalizeOrigemOption(cliente.origem),
      observacoes: cliente.observacoes || '',
    }
  }

  return {
    nome: '',
    cpf: '',
    telefone: '',
    email: '',
    empresa: '',
    cargo: '',
    endereco: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: '',
    cep: '',
    tipo: 'residencial' as const,
    origem: '',
    observacoes: '',
  }
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() || ''
}

function normalizeOrigemOption(value: string | undefined) {
  const trimmed = normalizeOptionalText(value)
  if (!trimmed) return ''

  const normalizedValue = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const matchedOption = origens.find((origem) => {
    const normalizedOption = origem
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    return normalizedOption === normalizedValue
  })

  return matchedOption || trimmed
}

function RequiredLabel({ children }: { children: string }) {
  return (
    <span>
      {children} <span className="text-destructive">*</span>
    </span>
  )
}

const emailSchema = z
  .string()
  .trim()
  .refine((value) => !value || z.string().email().safeParse(value).success, 'E-mail invalido')

const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((value) => !value || isValidBrazilPhone(value), 'Telefone deve estar em um formato brasileiro valido')

const optionalAddressSchema = z
  .string()
  .trim()
  .refine((value) => !value || value.length >= 5, 'Endereco muito curto')

const clienteSchema = z
  .object({
    nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
    cpf: z.string().trim(),
    telefone: optionalPhoneSchema,
    email: emailSchema,
    empresa: z.string().optional(),
    cargo: z.string().optional(),
    endereco: optionalAddressSchema,
    numero: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    estado: z.string().optional(),
    cep: z.string().optional(),
    tipo: z.enum(['residencial', 'comercial']),
    origem: z.string().optional(),
    observacoes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.cpf && !isValidClientDocument(data.cpf, data.tipo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cpf'],
        message: getClientDocumentValidationMessage(data.tipo),
      })
    }
  })

type ClienteFormData = z.infer<typeof clienteSchema>

interface ClientFormProps {
  open: boolean
  onClose: () => void
  cliente?: Cliente
}

const origens = ['Google Ads', 'Facebook', 'Instagram', 'Site', 'Indicacao', 'Prospeccao', 'Outro']

export function ClientForm({ open, onClose, cliente }: ClientFormProps) {
  const { addCliente, updateCliente } = useCRM()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const { isLookingUpCep, cepLookupError, lookupCep, setCepLookupError } = useCepLookup()

  const form = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: getClientFormDefaults(cliente),
  })
  const tipoSelecionado = form.watch('tipo')
  const cepValue = form.watch('cep')

  useEffect(() => {
    const currentDocument = form.getValues('cpf')
    const formattedDocument = formatClientDocument(currentDocument || '', tipoSelecionado)

    if (currentDocument !== formattedDocument) {
      form.setValue('cpf', formattedDocument, { shouldDirty: true, shouldValidate: true })
    }
  }, [form, tipoSelecionado])

  useEffect(() => {
    if (open) {
      form.reset(getClientFormDefaults(cliente))
      setSubmitError('')
      setCepLookupError('')
      setIsSubmitting(false)
    }
  }, [cliente, form, open, setCepLookupError])

  const onSubmit = async (data: ClienteFormData) => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setSubmitError('')

    const normalizedData = {
      ...data,
      cpf: formatClientDocument(data.cpf, data.tipo),
      empresa: data.tipo === 'comercial' ? normalizeOptionalText(data.empresa) : '',
      cargo: data.tipo === 'comercial' ? normalizeOptionalText(data.cargo) : '',
      email: data.email.trim(),
      telefone: formatBrazilPhone(data.telefone),
      endereco: normalizeOptionalText(data.endereco),
      numero: normalizeOptionalText(data.numero),
      bairro: normalizeOptionalText(data.bairro),
      cidade: normalizeOptionalText(data.cidade),
      estado: normalizeOptionalText(data.estado).toUpperCase(),
      cep: formatCep(data.cep || ''),
      observacoes: normalizeOptionalText(data.observacoes),
      origem: data.origem === 'nao_informado' ? '' : normalizeOrigemOption(data.origem),
      status: cliente?.status ?? 'lead_novo',
    }

    try {
      if (cliente) {
        await updateCliente({
          ...cliente,
          ...normalizedData,
        })
        toast.success('Cliente atualizado com sucesso')
      } else {
        await addCliente({
          ...normalizedData,
          observacoes: normalizedData.observacoes ?? '',
          ultimoContato: new Date(),
        })
        toast.success('Cliente criado com sucesso')
      }

      onClose()
      form.reset(getClientFormDefaults())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao salvar cliente.'
      setSubmitError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid = () => {
    toast.error('Revise os campos obrigatorios antes de salvar o cliente.')
  }

  const handleCepLookup = async () => {
    const result = await lookupCep(form.getValues('cep') || '')
    if (!result) {
      toast.error('Nao foi possivel localizar esse CEP.')
      return
    }

    form.setValue('cep', formatCep(result.cep), { shouldDirty: true, shouldValidate: true })
    if (result.logradouro || result.endereco) {
      form.setValue('endereco', result.logradouro || result.endereco, { shouldDirty: true, shouldValidate: true })
    }
    if (result.bairro) {
      form.setValue('bairro', result.bairro, { shouldDirty: true, shouldValidate: true })
    }
    if (result.cidade) {
      form.setValue('cidade', result.cidade, { shouldDirty: true, shouldValidate: true })
    }
    if (result.estado) {
      form.setValue('estado', result.estado, { shouldDirty: true, shouldValidate: true })
    }
    setCepLookupError('')
    toast.success('Endereco preenchido pelo CEP.')
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel><RequiredLabel>Nome</RequiredLabel></FormLabel>
                    <FormControl>
                      <Input placeholder="Nome completo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cpf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{getClientDocumentLabel(tipoSelecionado)}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={getClientDocumentPlaceholder(tipoSelecionado)}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={(e) => {
                          field.onChange(formatClientDocument(e.target.value, tipoSelecionado))
                          field.onBlur()
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(11) 9 9999-9999"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={(e) => {
                        field.onChange(formatBrazilPhone(e.target.value))
                          field.onBlur()
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="email@exemplo.com"
                        {...field}
                        onBlur={(e) => {
                          field.onChange(e.target.value.trim())
                          field.onBlur()
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {tipoSelecionado === 'comercial' && (
                <>
                  <FormField
                    control={form.control}
                    name="empresa"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Empresa</FormLabel>
                        <FormControl>
                          <Input placeholder="Nome da empresa" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cargo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cargo</FormLabel>
                        <FormControl>
                          <Input placeholder="Cargo do contato" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name="tipo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><RequiredLabel>Tipo</RequiredLabel></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="residencial">Residencial</SelectItem>
                        <SelectItem value="comercial">Comercial</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cep"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CEP</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="00000-000"
                          value={field.value || ''}
                          onChange={(event) => {
                            setCepLookupError('')
                            field.onChange(formatCep(event.target.value))
                          }}
                          onBlur={(event) => {
                            field.onChange(formatCep(event.target.value))
                            field.onBlur()
                          }}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => void handleCepLookup()}
                        pending={isLookingUpCep}
                        disabled={isLookingUpCep || (cepValue || '').replace(/\D/g, '').length !== 8}
                        aria-label="Buscar endereco pelo CEP"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </div>
                    {cepLookupError ? <p className="text-sm text-destructive">{cepLookupError}</p> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endereco"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rua / logradouro</FormLabel>
                    <FormControl>
                      <Input placeholder="Rua, avenida, travessa..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="numero"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Numero</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 120, sala 4" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bairro"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bairro</FormLabel>
                    <FormControl>
                      <Input placeholder="Bairro" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cidade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input placeholder="Cidade" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="estado"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="UF"
                        maxLength={2}
                        {...field}
                        value={field.value || ''}
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="origem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Origem</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'nao_informado'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Como chegou ate nos?" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="nao_informado">Nao informado</SelectItem>
                        {origens.map((origem) => (
                          <SelectItem key={origem} value={origem}>
                            {origem}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="observacoes"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Observacoes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Notas sobre o cliente..." rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" pending={isSubmitting}>
                {cliente ? 'Salvar Alteracoes' : 'Criar Cliente'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
