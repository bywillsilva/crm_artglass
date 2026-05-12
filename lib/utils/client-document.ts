import type { TipoCliente } from '@/lib/data/types'

const CPF_REGEX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/
const CNPJ_REGEX = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/

type ClientDocumentSource = {
  tipo?: TipoCliente | string | null
  empresa?: string | null
  cargo?: string | null
}

export function inferClientType(source?: ClientDocumentSource | null): TipoCliente {
  if (source?.tipo === 'comercial' || source?.tipo === 'residencial') {
    return source.tipo
  }

  return source?.empresa || source?.cargo ? 'comercial' : 'residencial'
}

export function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (!digits) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

export function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

export function formatClientDocument(value: string, tipo: TipoCliente) {
  return tipo === 'comercial' ? formatCnpj(value) : formatCpf(value)
}

export function isValidClientDocument(value: string, tipo: TipoCliente) {
  const trimmed = value.trim()
  if (!trimmed) return true

  return tipo === 'comercial' ? CNPJ_REGEX.test(trimmed) : CPF_REGEX.test(trimmed)
}

export function getClientDocumentLabel(tipo: TipoCliente) {
  return tipo === 'comercial' ? 'CNPJ' : 'CPF'
}

export function getClientDocumentPlaceholder(tipo: TipoCliente) {
  return tipo === 'comercial' ? '00.000.000/0000-00' : '000.000.000-00'
}

export function getClientDocumentValidationMessage(tipo: TipoCliente) {
  return tipo === 'comercial'
    ? 'CNPJ deve estar no formato 00.000.000/0000-00'
    : 'CPF deve estar no formato 000.000.000-00'
}
