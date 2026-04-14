'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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

const phoneRegex = /^\(\d{2}\) 9 \d{4}-\d{4}$/

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 3) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`
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

const clienteSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  telefone: z.string().regex(phoneRegex, 'Telefone deve estar no formato (xx) 9 xxxx-xxxx'),
  email: emailSchema,
  empresa: z.string().optional(),
  cargo: z.string().optional(),
  endereco: z.string().min(5, 'Endereco muito curto'),
  tipo: z.enum(['residencial', 'comercial']),
  origem: z.string().optional(),
  observacoes: z.string().optional(),
  valorEstimado: z.number().min(0, 'Valor deve ser positivo'),
}).superRefine((data, ctx) => {
  if (data.tipo === 'comercial' && !data.empresa?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['empresa'],
      message: 'Empresa obrigatoria para cliente comercial',
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

  const form = useForm<ClienteFormData>({
    resolver: zodResolver(clienteSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: cliente
      ? {
          nome: cliente.nome,
          telefone: cliente.telefone,
          email: cliente.email,
          empresa: cliente.empresa || '',
          cargo: cliente.cargo || '',
          endereco: cliente.endereco,
          tipo: cliente.tipo,
          origem: cliente.origem || '',
          observacoes: cliente.observacoes,
          valorEstimado: cliente.valorEstimado,
        }
      : {
          nome: '',
          telefone: '',
          email: '',
          empresa: '',
          cargo: '',
          endereco: '',
          tipo: 'residencial',
          origem: '',
          observacoes: '',
          valorEstimado: 0,
        },
  })
  const tipoSelecionado = form.watch('tipo')

  useEffect(() => {
    if (open) {
      form.reset(
        cliente
          ? {
              nome: cliente.nome,
              telefone: cliente.telefone,
              email: cliente.email,
              empresa: cliente.empresa || '',
              cargo: cliente.cargo || '',
              endereco: cliente.endereco,
              tipo: cliente.tipo,
              origem: cliente.origem || '',
              observacoes: cliente.observacoes,
              valorEstimado: cliente.valorEstimado,
            }
          : {
              nome: '',
              telefone: '',
              email: '',
              empresa: '',
              cargo: '',
              endereco: '',
              tipo: 'residencial',
              origem: '',
              observacoes: '',
              valorEstimado: 0,
            }
      )
    }
  }, [cliente, form, open])

  const onSubmit = async (data: ClienteFormData) => {
    const normalizedData = {
      ...data,
      empresa: data.tipo === 'comercial' ? data.empresa?.trim() || '' : '',
      cargo: data.tipo === 'comercial' ? data.cargo?.trim() || '' : '',
      email: data.email.trim(),
      origem: data.origem === 'nao_informado' ? '' : data.origem?.trim() || '',
      status: cliente?.status ?? 'lead_novo',
    }

    if (cliente) {
      await updateCliente({
        ...cliente,
        ...normalizedData,
      })
    } else {
      await addCliente({
        ...normalizedData,
        observacoes: normalizedData.observacoes ?? '',
        ultimoContato: new Date(),
      })
    }

    onClose()
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><RequiredLabel>Telefone</RequiredLabel></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(11) 9 9999-9999"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={(e) => {
                          field.onChange(formatPhone(e.target.value))
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
                        <FormLabel><RequiredLabel>Empresa</RequiredLabel></FormLabel>
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
                name="endereco"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel><RequiredLabel>Endereco</RequiredLabel></FormLabel>
                    <FormControl>
                      <Input placeholder="Rua, numero - Cidade, UF" {...field} />
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
                name="valorEstimado"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><RequiredLabel>Valor Estimado</RequiredLabel></FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
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

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit">{cliente ? 'Salvar Alteracoes' : 'Criar Cliente'}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
