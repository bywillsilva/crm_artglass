import {
  posFechamentoEtapaLabels,
  posFechamentoEtapas,
  type PosFechamentoEtapa,
  type Proposta,
} from '@/lib/data/types'

export const postClosingDateFields: Record<PosFechamentoEtapa, keyof Proposta> = {
  aguardando_contrato: 'posFechamentoAguardandoContratoAt',
  contrato_feito: 'posFechamentoContratoFeitoAt',
  contrato_enviado: 'posFechamentoContratoEnviadoAt',
  contrato_assinado: 'posFechamentoContratoAssinadoAt',
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

export function isPostClosingProposal(proposta: Partial<Proposta> | null | undefined) {
  return proposta?.status === 'pos_fechamento'
}

export function hasConfirmedPayment(proposta: Partial<Proposta> | null | undefined) {
  return Boolean(proposta?.posFechamentoPagamentoConfirmadoAt)
}

export function hasProductionReleased(proposta: Partial<Proposta> | null | undefined) {
  return Boolean(proposta?.posFechamentoOrdemServicoLiberadaAt)
}
