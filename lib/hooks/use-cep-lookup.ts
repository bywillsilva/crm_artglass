'use client'

import { useCallback, useState } from 'react'

export type CepLookupResult = {
  cep: string
  endereco: string
  logradouro: string
  bairro: string
  complemento: string
  cidade: string
  estado: string
}

export function onlyCepDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 8)
}

export function formatCep(value: string) {
  const digits = onlyCepDigits(value)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function useCepLookup() {
  const [isLookingUpCep, setIsLookingUpCep] = useState(false)
  const [cepLookupError, setCepLookupError] = useState('')

  const lookupCep = useCallback(async (rawCep: string) => {
    const cep = onlyCepDigits(rawCep)
    setCepLookupError('')

    if (cep.length !== 8) {
      setCepLookupError('Informe um CEP com 8 digitos.')
      return null
    }

    setIsLookingUpCep(true)
    try {
      const response = await fetch(`/api/cep/${cep}`)
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Nao foi possivel consultar o CEP.')
      }

      return data as CepLookupResult
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nao foi possivel consultar o CEP.'
      setCepLookupError(message)
      return null
    } finally {
      setIsLookingUpCep(false)
    }
  }, [])

  return {
    isLookingUpCep,
    cepLookupError,
    lookupCep,
    setCepLookupError,
  }
}
