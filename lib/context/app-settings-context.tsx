'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import useSWR, { mutate } from 'swr'
import { useTheme } from 'next-themes'
import { saveConfiguracao, useSession } from '@/lib/hooks/use-api'
import { parseDateTimeValue } from '@/lib/utils/date-time'

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
  nome: 'SolarTech Energia',
  cnpj: '12.345.678/0001-90',
  telefone: '(11) 3333-4444',
  email: 'contato@solartech.com',
  endereco: 'Av. Paulista, 1000 - Sao Paulo, SP',
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

const toDateValue = parseDateTimeValue

const AppSettingsContext = createContext<AppSettingsContextType | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSWR('/api/configuracoes', fetcher)
  const { setTheme } = useTheme()
  const { user } = useSession()

  const [general, setGeneral] = useState(defaultGeneral)
  const [notifications, setNotifications] = useState(defaultNotifications)
  const [appearance, setAppearance] = useState(defaultAppearance)
  const [company, setCompany] = useState(defaultCompany)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  )

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
    setCompany(parseJson(configMap.get('empresa'), defaultCompany))
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
    document.title = company.nome ? `${company.nome} - CRM` : 'CRM'
  }, [appearance, company.nome, setTheme])

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
      requests.push(saveConfiguracao('empresa', company))
    }

    await Promise.all(requests)

    mutate('/api/configuracoes')
  }, [appearance, company, general, notifications, user?.role])

  const formatCurrency = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(appearance.idioma, {
        style: 'currency',
        currency: appearance.formatoMoeda,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
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
