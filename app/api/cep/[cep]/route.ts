import { NextResponse } from 'next/server'
import { jsonNoStore } from '@/lib/server/http-cache'

type ViaCepResponse = {
  cep?: string
  logradouro?: string
  complemento?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cep: string }> }
) {
  const { cep } = await params
  const normalizedCep = onlyDigits(cep || '')

  if (normalizedCep.length !== 8) {
    return jsonNoStore({ error: 'CEP invalido' }, { status: 400 })
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${normalizedCep}/json/`, {
      cache: 'force-cache',
      next: { revalidate: 60 * 60 * 24 * 30 },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return jsonNoStore({ error: 'Nao foi possivel consultar o CEP' }, { status: 502 })
    }

    const data = (await response.json()) as ViaCepResponse
    if (data.erro) {
      return jsonNoStore({ error: 'CEP nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      cep: data.cep || normalizedCep,
      endereco: data.logradouro || '',
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      complemento: data.complemento || '',
      cidade: data.localidade || '',
      estado: data.uf || '',
    })
  } catch (error) {
    console.error('Erro ao consultar CEP:', error)
    return jsonNoStore({ error: 'Consulta de CEP temporariamente indisponivel' }, { status: 503 })
  }
}
