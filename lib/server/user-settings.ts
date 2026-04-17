import { query } from '@/lib/db/mysql'
import { sendEmail } from '@/lib/email'

export type EffectiveGeneralSettings = {
  demoMode: boolean
  autoSave: boolean
  confirmDeletes: boolean
  twoFactor: boolean
  sessionTimeout: string
}

export type EffectiveNotificationSettings = {
  email: boolean
  browser: boolean
  tarefas: boolean
  propostas: boolean
  novosLeads: boolean
}

const defaultGeneral: EffectiveGeneralSettings = {
  demoMode: false,
  autoSave: true,
  confirmDeletes: true,
  twoFactor: false,
  sessionTimeout: '30',
}

const defaultNotifications: EffectiveNotificationSettings = {
  email: true,
  browser: true,
  tarefas: true,
  propostas: true,
  novosLeads: true,
}

function parseJson<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value) return fallback

  if (typeof value === 'object') {
    return { ...fallback, ...(value as object) } as T
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return { ...fallback, ...(parsed as object) } as T
    } catch {
      return fallback
    }
  }

  return fallback
}

export async function getEffectiveUserSettings(userId: string) {
  const configs = await query<any[]>(
    `SELECT chave, scope, valor
     FROM configuracoes
     WHERE chave IN ('geral', 'notificacoes')
       AND (
         (scope = 'user' AND user_id = ?)
         OR (scope = 'global' AND user_id = '')
       )
     ORDER BY chave, CASE WHEN scope = 'user' THEN 0 ELSE 1 END`,
    [userId]
  )

  const byKey = new Map<string, any>()
  configs.forEach((config) => {
    if (!byKey.has(config.chave)) {
      byKey.set(config.chave, config.valor)
    }
  })

  return {
    general: parseJson(byKey.get('geral'), defaultGeneral),
    notifications: parseJson(byKey.get('notificacoes'), defaultNotifications),
  }
}

export async function userHasTwoFactorEnabled(userId: string) {
  const settings = await getEffectiveUserSettings(userId)
  return Boolean(settings.general.twoFactor)
}

export async function shouldSendEmailNotification(
  userId: string,
  notificationType: keyof Pick<EffectiveNotificationSettings, 'tarefas' | 'propostas' | 'novosLeads'>
) {
  const settings = await getEffectiveUserSettings(userId)
  return Boolean(settings.notifications.email && settings.notifications[notificationType])
}

export async function safeSendEmail(params: {
  to: string
  subject: string
  html: string
  text?: string
}) {
  try {
    await sendEmail(params)
    return true
  } catch (error) {
    console.error('Falha ao enviar e-mail transacional:', error)
    return false
  }
}
