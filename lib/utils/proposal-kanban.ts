import type { RoleUsuario, StatusProposta, Tarefa } from '@/lib/data/types'

const FOLLOW_UP_STATUSES: StatusProposta[] = [
  'follow_up_1_dia',
  'follow_up_3_dias',
  'follow_up_7_dias',
]

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getHoursUntil(target: Date, now: Date) {
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60)
}

export function isFollowUpStatus(status?: StatusProposta | null) {
  return FOLLOW_UP_STATUSES.includes((status || 'novo_cliente') as StatusProposta)
}

export function getProposalTaskStage(status: StatusProposta) {
  if (status === 'em_orcamento') return 'em_orcamento'
  if (status === 'em_retificacao') return 'em_retificacao'
  if (status === 'enviar_ao_cliente') return 'enviar_ao_cliente'
  return status
}

export function resolveProposalStatusForPersistence(
  currentStatus: StatusProposta,
  targetStatus: StatusProposta
) {
  if (currentStatus === 'follow_up_1_dia' && targetStatus === 'follow_up_3_dias') {
    return 'aguardando_follow_up_3_dias' as StatusProposta
  }

  if (currentStatus === 'follow_up_3_dias' && targetStatus === 'follow_up_7_dias') {
    return 'aguardando_follow_up_7_dias' as StatusProposta
  }

  return targetStatus
}

export function requiresFollowUpTimeForMove(role: RoleUsuario | undefined, targetStatus?: StatusProposta | null) {
  return role === 'vendedor' && isFollowUpStatus(targetStatus)
}

export function requiresSellerCommentForMove(
  role: RoleUsuario | undefined,
  currentStatus?: StatusProposta | null,
  targetStatus?: StatusProposta | null
) {
  if (role !== 'vendedor') return false
  if (!currentStatus || !targetStatus) return false
  return isFollowUpStatus(currentStatus) && currentStatus !== targetStatus
}

export function getProposalCardVisualState(
  status: StatusProposta,
  task: Tarefa | undefined,
  formatDateTime: (value: Date | string) => string
) {
  if (!task) {
    return { classes: 'border-border bg-card', label: '' }
  }

  const now = new Date()
  const dueDate = new Date(task.dataHora)

  if (status === 'em_orcamento') {
    const warningAt = new Date(dueDate)
    warningAt.setDate(warningAt.getDate() - 1)

    if (now >= dueDate) {
      return { classes: 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30', label: 'Orcamento em atraso' }
    }

    if (now >= warningAt) {
      return { classes: 'border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/25', label: 'Prazo do orcamento apertado' }
    }
  }

  if (status === 'enviar_ao_cliente' && now > dueDate) {
    return { classes: 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30', label: 'Envio ao cliente atrasado' }
  }

  if (isFollowUpStatus(status)) {
    const hoursUntilDue = getHoursUntil(dueDate, now)

    if (now > dueDate) {
      return { classes: 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30', label: 'Follow-up atrasado' }
    }

    if (isSameDay(now, dueDate)) {
      return { classes: 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30', label: 'Follow-up no dia certo' }
    }

    if (hoursUntilDue <= 12) {
      return { classes: 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/25', label: 'Follow-up se aproximando' }
    }
  }

  return {
    classes: 'border-border bg-card',
    label: task ? `Prazo ${formatDateTime(task.dataHora)}` : '',
  }
}
