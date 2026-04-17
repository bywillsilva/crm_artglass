import { query } from '@/lib/db/mysql'
import { buildEmailTemplate } from '@/lib/email'
import { getEmailBranding } from '@/lib/server/email-branding'
import { safeSendEmail, shouldSendEmailNotification } from '@/lib/server/user-settings'

async function getUserEmailTarget(userId: string | null | undefined) {
  if (!userId) return null

  const [user] = await query<any[]>(
    'SELECT id, nome, email, ativo FROM usuarios WHERE id = ? LIMIT 1',
    [userId]
  )

  if (!user || !user.ativo || !user.email) {
    return null
  }

  return user
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
  actorUserId?: string | null
  actorName?: string | null
  proposalNumber?: string | null
  proposalTitle?: string | null
  nextStatusLabel: string
}) {
  if (!params.responsavelId || params.responsavelId === params.actorUserId) {
    return
  }

  const targetUser = await getUserEmailTarget(params.responsavelId)
  if (!targetUser) return

  const shouldSend = await shouldSendEmailNotification(targetUser.id, 'propostas')
  if (!shouldSend) return

  const branding = await getEmailBranding()
  const actorName = params.actorName || 'Um usuario do CRM'
  const proposalLabel = params.proposalNumber || params.proposalTitle || 'Uma proposta'
  const emailContent = buildEmailTemplate({
    appName: branding.appName,
    title: 'Atualizacao de proposta',
    greeting: `Ola, ${targetUser.nome}.`,
    intro: `${actorName} atualizou o andamento de uma proposta sob sua responsabilidade.`,
    highlightLabel: 'Novo status',
    highlightValue: params.nextStatusLabel,
    outro: `Proposta: ${proposalLabel}`,
  })

  await safeSendEmail({
    to: targetUser.email,
    subject: `${branding.appName} - Atualizacao de proposta`,
    text: emailContent.text,
    html: emailContent.html,
  })
}
