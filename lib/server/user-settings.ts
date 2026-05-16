import { prisma } from '@/lib/db/prisma'
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

function isUnknownColumnError(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error ? String((error as any).code) : ''
  const message =
    typeof error === 'object' && error && 'sqlMessage' in error
      ? String((error as any).sqlMessage || '')
      : typeof error === 'object' && error && 'message' in error
        ? String((error as any).message || '')
        : ''

  return code === 'ER_BAD_FIELD_ERROR' || /unknown column/i.test(message)
}

export async function getEffectiveUserSettings(userId: string) {
  try {
    let configs: any[]

    try {
      configs = await prisma.configuracoes.findMany({
        where: {
          chave: {
            in: ['geral', 'notificacoes'],
          },
          OR: [
            { scope: 'user', user_id: userId },
            { scope: 'global', user_id: '' },
          ],
        },
        select: {
          chave: true,
          scope: true,
          valor: true,
        },
        orderBy: {
          chave: 'asc',
        },
      })
      configs = configs.sort((a, b) => {
        const keyOrder = String(a.chave).localeCompare(String(b.chave))
        if (keyOrder !== 0) {
          return keyOrder
        }
        const priorityA = a.scope === 'user' ? 0 : 1
        const priorityB = b.scope === 'user' ? 0 : 1
        return priorityA - priorityB
      })
    } catch (error) {
      if (!isUnknownColumnError(error)) {
        throw error
      }

      configs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT chave, 'global' as scope, valor
         FROM configuracoes
         WHERE chave IN ('geral', 'notificacoes')
         ORDER BY chave`
      )
    }

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
  } catch {
    return {
      general: defaultGeneral,
      notifications: defaultNotifications,
    }
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
