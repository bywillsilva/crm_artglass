'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import useSWR, { mutate } from 'swr'
import { useTheme } from 'next-themes'
import { saveConfiguracao, useSession } from '@/lib/hooks/use-api'
import { parseDateTimeValue } from '@/lib/utils/date-time'
import { formatBrazilPhone } from '@/lib/utils/phone'

type ConfiguracaoRecord = { chave: string; valor: any }

export type GeneralSettings = {
  demoMode: boolean
  autoSave: boolean
  confirmDeletes: boolean
  twoFactor: boolean
  sessionTimeout: string
}

export type NotificationSettings = {
  email: boolean
  browser: boolean
  tarefas: boolean
  propostas: boolean
  novosLeads: boolean
}

export type AppearanceSettings = {
  tema: 'escuro' | 'claro' | 'sistema'
  idioma: 'pt-BR' | 'en-US' | 'es-ES'
  formatoData: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
  formatoMoeda: 'BRL' | 'USD' | 'EUR'
}

export type CompanySettings = {
  nome: string
  cnpj: string
  telefone: string
  email: string
  endereco: string
}

type AppSettingsContextType = {
  general: GeneralSettings
  notifications: NotificationSettings
  appearance: AppearanceSettings
  company: CompanySettings
  isLoading: boolean
  setGeneral: (value: GeneralSettings) => void
  setNotifications: (value: NotificationSettings) => void
  setAppearance: (value: AppearanceSettings) => void
  setCompany: (value: CompanySettings) => void
  saveAll: () => Promise<void>
  canEditCompany: boolean
  formatCurrency: (value: number) => string
  formatDate: (value: string | Date) => string
  formatDateTime: (value: string | Date) => string
  formatTime: (value: string | Date) => string
  notificationPermission: NotificationPermission | 'unsupported'
  requestNotificationPermission: () => Promise<NotificationPermission | 'unsupported'>
}

const defaultGeneral: GeneralSettings = {
  demoMode: false,
  autoSave: true,
  confirmDeletes: true,
  twoFactor: false,
  sessionTimeout: '30',
}

const defaultNotifications: NotificationSettings = {
  email: true,
  browser: true,
  tarefas: true,
  propostas: true,
  novosLeads: true,
}

const defaultAppearance: AppearanceSettings = {
  tema: 'escuro',
  idioma: 'pt-BR',
  formatoData: 'dd/MM/yyyy',
  formatoMoeda: 'BRL',
}

const defaultCompany: CompanySettings = {
  nome: '',
  cnpj: '',
  telefone: '',
  email: '',
  endereco: '',
}

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || 'Erro ao carregar configuracoes')
  }

  return data
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'object') return { ...fallback, ...(value as object) } as T
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

function normalizeCompanySettings(value: CompanySettings) {
  return {
    ...value,
    telefone: formatBrazilPhone(value.telefone),
  }
}

const toDateValue = parseDateTimeValue
const SESSION_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart'] as const

const AppSettingsContext = createContext<AppSettingsContextType | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSWR('/api/configuracoes', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: 60000,
    errorRetryCount: 0,
    shouldRetryOnError: false,
  })
  const { setTheme } = useTheme()
  const { user } = useSession()

  const [general, setGeneral] = useState(defaultGeneral)
  const [notifications, setNotifications] = useState(defaultNotifications)
  const [appearance, setAppearance] = useState(defaultAppearance)
  const [company, setCompany] = useState(defaultCompany)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  )
  const logoutInFlightRef = useRef(false)

  useEffect(() => {
    if (!Array.isArray(data)) return

    const configMap = new Map<string, unknown>()
    data.forEach((item: ConfiguracaoRecord) => {
      configMap.set(item.chave, item.valor)
    })

    setGeneral(parseJson(configMap.get('geral'), defaultGeneral))
    setNotifications(
      parseJson(configMap.get('notificacoes'), defaultNotifications)
    )
    setAppearance(parseJson(configMap.get('aparencia'), defaultAppearance))
    setCompany(normalizeCompanySettings(parseJson(configMap.get('empresa'), defaultCompany)))
  }, [data])

  useEffect(() => {
    const nextTheme =
      appearance.tema === 'escuro'
        ? 'dark'
        : appearance.tema === 'claro'
          ? 'light'
          : 'system'

    setTheme(nextTheme)
    document.documentElement.lang = appearance.idioma
    document.documentElement.dataset.demoMode = general.demoMode ? 'true' : 'false'
    document.body.dataset.demoMode = general.demoMode ? 'true' : 'false'

    const baseTitle = company.nome ? `${company.nome} - CRM` : 'CRM'
    document.title = general.demoMode ? `[DEMO] ${baseTitle}` : baseTitle
  }, [appearance, company.nome, general.demoMode, setTheme])

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id) return

    const timeoutInMinutes = Number(general.sessionTimeout)
    if (!Number.isFinite(timeoutInMinutes) || timeoutInMinutes <= 0) return

    let timeoutId: number | null = null

    const logoutUser = () => {
      if (logoutInFlightRef.current) return
      logoutInFlightRef.current = true

      void fetch('/api/auth/logout', { method: 'POST' })
        .catch(() => null)
        .finally(() => {
          window.location.assign('/login?motivo=sessao-expirada')
        })
    }

    const resetTimeout = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      timeoutId = window.setTimeout(logoutUser, timeoutInMinutes * 60 * 1000)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resetTimeout()
      }
    }

    resetTimeout()
    SESSION_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetTimeout, { passive: true })
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', resetTimeout)

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }

      SESSION_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimeout)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', resetTimeout)
      logoutInFlightRef.current = false
    }
  }, [general.sessionTimeout, user?.id])

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return 'unsupported'
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    return permission
  }

  const saveAll = useCallback(async () => {
    const requests = [
      saveConfiguracao('geral', general),
      saveConfiguracao('notificacoes', notifications),
      saveConfiguracao('aparencia', appearance),
    ]

    if (user?.role === 'admin') {
      requests.push(saveConfiguracao('empresa', normalizeCompanySettings(company)))
    }

    await Promise.all(requests)

    mutate('/api/configuracoes')
  }, [appearance, company, general, notifications, user?.role])

  const formatCurrency = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(appearance.idioma, {
        style: 'currency',
        currency: appearance.formatoMoeda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value),
    [appearance.formatoMoeda, appearance.idioma]
  )

  const formatDate = useMemo(
    () => (value: string | Date) => {
      const date = toDateValue(value)
      if (appearance.formatoData === 'MM/dd/yyyy') {
        return new Intl.DateTimeFormat(appearance.idioma, {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
        }).format(date)
      }

      if (appearance.formatoData === 'yyyy-MM-dd') {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate()
        ).padStart(2, '0')}`
      }

      return new Intl.DateTimeFormat(appearance.idioma, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
    },
    [appearance.formatoData, appearance.idioma]
  )

  const formatDateTime = useMemo(
    () => (value: string | Date) => {
      const date = toDateValue(value)
      const datePart = formatDate(date)
      const timePart = new Intl.DateTimeFormat(appearance.idioma, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)

      return `${datePart} ${timePart}`
    },
    [appearance.idioma, formatDate]
  )

  const formatTime = useMemo(
    () => (value: string | Date) => {
      const date = toDateValue(value)
      return new Intl.DateTimeFormat(appearance.idioma, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    },
    [appearance.idioma]
  )

  return (
    <AppSettingsContext.Provider
      value={{
        general,
        notifications,
        appearance,
        company,
        isLoading,
        setGeneral,
        setNotifications,
        setAppearance,
        setCompany,
        saveAll,
        canEditCompany: user?.role === 'admin',
        formatCurrency,
        formatDate,
        formatDateTime,
        formatTime,
        notificationPermission,
        requestNotificationPermission,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  )
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (!context) {
    throw new Error('useAppSettings deve ser usado dentro de um AppSettingsProvider')
  }

  return context
}
