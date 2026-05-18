import {
  posFechamentoEtapaLabels,
  posFechamentoEtapas,
  type PosFechamentoEtapa,
  type Proposta,
} from '@/lib/data/types'

export const postClosingDateFields: Record<PosFechamentoEtapa, keyof Proposta> = {
  contrato_feito: 'posFechamentoContratoFeitoAt',
  contrato_enviado: 'posFechamentoContratoEnviadoAt',
  aguardando_pagamento: 'posFechamentoAguardandoPagamentoAt',
  pagamento_confirmado: 'posFechamentoPagamentoConfirmadoAt',
  aguardando_os: 'posFechamentoAguardandoOsAt',
  ordem_servico_liberada: 'posFechamentoOrdemServicoLiberadaAt',
}

export function isPostClosingStepCompleted(
  proposta: Partial<Proposta> | null | undefined,
  step: PosFechamentoEtapa
) {
  if (!proposta) {
    return false
  }

  if (step === 'aguardando_pagamento') {
    return Boolean(
        proposta.posFechamentoAguardandoPagamentoAt ||
        proposta.posFechamentoPagamentoConfirmadoAt ||
        proposta.posFechamentoAguardandoOsAt ||
        proposta.posFechamentoOrdemServicoLiberadaAt
    )
  }

  if (step === 'aguardando_os') {
    return Boolean(
      proposta.posFechamentoAguardandoOsAt ||
        proposta.posFechamentoOrdemServicoLiberadaAt
    )
  }

  return Boolean(proposta[postClosingDateFields[step]])
}

export function getCompletedPostClosingSteps(proposta: Partial<Proposta> | null | undefined) {
  if (!proposta) {
    return [] as PosFechamentoEtapa[]
  }

  return posFechamentoEtapas.filter((step) => isPostClosingStepCompleted(proposta, step))
}

export function getCurrentPostClosingStep(proposta: Partial<Proposta> | null | undefined) {
  const completed = getCompletedPostClosingSteps(proposta)
  return completed.length ? completed[completed.length - 1] : null
}

export function getCurrentPostClosingLabel(proposta: Partial<Proposta> | null | undefined) {
  const completed = getCompletedPostClosingSteps(proposta)
  if (completed.length === posFechamentoEtapas.length) {
    return 'Concluido'
  }

  const currentStep = completed.length ? completed[completed.length - 1] : null
  return currentStep ? posFechamentoEtapaLabels[currentStep] : 'Aguardando contrato'
}
