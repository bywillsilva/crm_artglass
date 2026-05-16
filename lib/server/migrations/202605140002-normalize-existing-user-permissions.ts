import { prisma } from '@/lib/db/prisma'
import { getDefaultModulePermissions } from '@/lib/auth/module-access'
import { getDefaultRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'
import { clearAuthenticatedUserCache } from '@/lib/auth/session'
import { syncNormalizedUserPermissions } from '@/lib/server/user-permissions-store'

async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const isRead = /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)
  if (isRead) {
    return prisma.$queryRawUnsafe<T>(sql, ...params)
  }

  return prisma.$executeRawUnsafe(sql, ...params) as T
}

function normalizeRole(value: unknown): RoleUsuario {
  if (value === 'admin' || value === 'gerente' || value === 'orcamentista' || value === 'vendedor') {
    return value
  }

  return 'vendedor'
}

export const migration202605140002 = {
  version: '202605140002',
  name: 'normalize-existing-user-permissions',
  async run() {
    const users = await query<Array<{ id: string; role: string | null }>>(
      `SELECT id, role
       FROM usuarios`
    )

    for (const user of users) {
      const role = normalizeRole(user.role)
      const modulePermissions = getDefaultModulePermissions(role)
      const rulePermissions = getDefaultRulePermissions(role)

      await query(
        `UPDATE usuarios
         SET module_permissions = ?, rule_permissions = ?
         WHERE id = ?`,
        [JSON.stringify(modulePermissions), JSON.stringify(rulePermissions), user.id]
      )

      await syncNormalizedUserPermissions({
        userId: user.id,
        role,
        modulePermissions,
        rulePermissions,
      })
    }

    clearAuthenticatedUserCache()
  },
}
