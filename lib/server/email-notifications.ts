import { prisma } from '@/lib/db/prisma'
import { buildEmailTemplate } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'
import { safeSendEmail, shouldSendEmailNotification } from '@/lib/server/user-settings'

async function getUserEmailTarget(userId: string | null | undefined) {
  if (!userId) return null

  const user = await prisma.usuarios.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      ativo: true,
    },
  })

  if (!user || !user.ativo || !user.email) {
    return null
  }

  return user
}

async function getProposalEmailTargets(params: {
  targetUserIds: string[]
  orcamentistaId?: string | null | undefined
  actorUserId?: string | null
  allowedRoles?: string[]
}) {
  const explicitIds = Array.from(new Set(params.targetUserIds.filter(Boolean)))
  const allowedRoles = params.allowedRoles ?? []
  const roleConditions: any[] = []

  if (allowedRoles.length > 0) {
    roleConditions.push({ role: { in: allowedRoles } })
  }

  if (explicitIds.length > 0) {
    roleConditions.push({ id: { in: explicitIds } })
  }

  if (roleConditions.length === 0) {
    return []
  }

  const users = await prisma.usuarios.findMany({
    where: {
      ativo: true,
      email: {
        not: '',
      },
      OR: roleConditions,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      ativo: true,
      role: true,
    },
  })

  return users.filter((user) => user?.id && user.id !== params.actorUserId)
}

export async function notifyTaskEmail(params: {
  responsavelId: string | null | undefined
  actorUserId?: string | null
  actorName?: string | null
  titulo: string
  descricao?: string | null
  dataHora?: string | Date | null
  action: 'created' | 'updated' | 'status_changed'
}) {
  if (!params.responsavelId || params.responsavelId === params.actorUserId) {
    return
  }

  const targetUser = await getUserEmailTarget(params.responsavelId)
  if (!targetUser) return

  const shouldSend = await shouldSendEmailNotification(targetUser.id, 'tarefas')
  if (!shouldSend) return

  const branding = await getEmailBranding()
  const actorName = params.actorName || 'Um usuario do CRM'
  const emailContent = buildEmailTemplate({
    appName: branding.appName,
    title: 'Atualizacao de tarefa',
    greeting: `Ola, ${targetUser.nome}.`,
    intro: `${actorName} atualizou uma tarefa sob sua responsabilidade.`,
    highlightLabel: 'Tarefa',
    highlightValue: params.titulo,
    outro: `${params.descricao ? `${params.descricao}\n\n` : ''}${params.dataHora ? `Prazo: ${new Date(params.dataHora).toLocaleString('pt-BR')}` : 'Acesse o CRM para acompanhar os detalhes.'}`,
  })

  await safeSendEmail({
    to: targetUser.email,
    subject: `${branding.appName} - Atualizacao de tarefa`,
    text: emailContent.text,
    html: emailContent.html,
  })
}

export async function notifyProposalEmail(params: {
  responsavelId: string | null | undefined
  orcamentistaId?: string | null
  actorUserId?: string | null
  actorName?: string | null
  actorRole?: string | null
  proposalNumber?: string | null
  proposalTitle?: string | null
  clientName?: string | null
  nextStatus: string
  nextStatusLabel: string
}) {
  const targetUserIds: string[] = []
  const allowedRoles: string[] = []

  if (params.nextStatus === 'aguardando_aprovacao' && params.actorRole === 'orcamentista') {
    allowedRoles.push('admin')
  }

  if (params.nextStatus === 'enviar_ao_cliente' && params.responsavelId) {
    targetUserIds.push(params.responsavelId)
  }

  if (params.nextStatus === 'em_retificacao' && params.orcamentistaId) {
    targetUserIds.push(params.orcamentistaId)
  }

  const targetUsers = await getProposalEmailTargets({
    targetUserIds,
    actorUserId: params.actorUserId,
    allowedRoles,
  })
  if (targetUsers.length === 0) return

  const branding = await getEmailBranding()
  const actorName = params.actorName || 'Um usuario do CRM'
  const proposalLabel = params.proposalNumber || params.proposalTitle || 'Uma proposta'
  const clientLabel = typeof params.clientName === 'string' && params.clientName.trim()
    ? params.clientName.trim()
    : null

  await Promise.all(
    targetUsers.map(async (targetUser) => {
      const shouldSend = await shouldSendEmailNotification(targetUser.id, 'propostas')
      if (!shouldSend) return

      const emailContent = buildEmailTemplate({
        appName: branding.appName,
        title: 'Atualizacao de proposta',
        greeting: `Ola, ${targetUser.nome}.`,
        intro: `${actorName} movimentou uma proposta no funil de vendas.`,
        highlightLabel: 'Novo status',
        highlightValue: params.nextStatusLabel,
        outro: clientLabel
          ? `Proposta: ${proposalLabel}\nCliente: ${clientLabel}`
          : `Proposta: ${proposalLabel}`,
      })

      await safeSendEmail({
        to: targetUser.email,
        subject: `${branding.appName} - Atualizacao de proposta`,
        text: emailContent.text,
        html: emailContent.html,
      })
    })
  )
}
