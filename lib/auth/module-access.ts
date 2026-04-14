import type {
  ModuleKey as ModuleKeyType,
  ModulePermissions as ModulePermissionsType,
  RoleUsuario,
} from '@/lib/data/types'

export type ModuleKey = ModuleKeyType
export type ModulePermissions = ModulePermissionsType

export const MODULE_KEYS: ModuleKey[] = [
  'dashboard',
  'clientes',
  'funil',
  'propostas',
  'tarefas',
  'relatorios',
  'performance',
  'usuarios',
]

export const moduleLabels: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  clientes: 'Clientes',
  funil: 'Funil de Vendas',
  propostas: 'Propostas',
  tarefas: 'Tarefas',
  relatorios: 'Relatorios',
  performance: 'Performance',
  usuarios: 'Usuarios',
}

const ALL_ENABLED = MODULE_KEYS.reduce((acc, key) => {
  acc[key] = true
  return acc
}, {} as ModulePermissions)

export function getDefaultModulePermissions(role: RoleUsuario): ModulePermissions {
  if (role === 'admin') {
    return { ...ALL_ENABLED }
  }

  if (role === 'gerente') {
    return {
      dashboard: true,
      clientes: true,
      funil: true,
      propostas: true,
      tarefas: true,
      relatorios: false,
      performance: false,
      usuarios: false,
    }
  }

  if (role === 'orcamentista') {
    return {
      dashboard: false,
      clientes: true,
      funil: true,
      propostas: true,
      tarefas: false,
      relatorios: false,
      performance: false,
      usuarios: false,
    }
  }

  return {
    dashboard: true,
    clientes: true,
    funil: true,
    propostas: true,
    tarefas: true,
    relatorios: false,
    performance: false,
    usuarios: false,
  }
}

export function normalizeModulePermissions(
  value: unknown,
  role: RoleUsuario | null | undefined
): ModulePermissions {
  const safeRole = role || 'vendedor'
  if (safeRole === 'admin') {
    return { ...ALL_ENABLED }
  }

  const defaults = getDefaultModulePermissions(safeRole)
  if (!value || typeof value !== 'object') {
    return defaults
  }

  const source = value as Record<string, unknown>
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = key in source ? Boolean(source[key]) : defaults[key]
    return acc
  }, { ...defaults } as ModulePermissions)
}

export function hasModuleAccess(
  user:
    | {
        role?: string | null
        modulePermissions?: Partial<Record<ModuleKey, boolean>> | null
      }
    | null
    | undefined,
  module: ModuleKey
) {
  if (!user?.role) return false
  if (user.role === 'admin') return true
  return normalizeModulePermissions(
    user.modulePermissions,
    user.role as RoleUsuario
  )[module]
}
