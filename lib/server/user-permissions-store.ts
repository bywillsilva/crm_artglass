import { MODULE_KEYS, normalizeModulePermissions } from '@/lib/auth/module-access'
import { RULE_KEYS, normalizeRulePermissions } from '@/lib/auth/rule-access'
import type { RoleUsuario } from '@/lib/data/types'
import { executeSql, type SqlExecutor } from '@/lib/server/db-executor'

export async function syncNormalizedUserPermissions(
  params: {
    userId: string
    role: RoleUsuario
    modulePermissions: unknown
    rulePermissions: unknown
  },
  executor?: SqlExecutor | null
) {
  const modulePermissions = normalizeModulePermissions(params.modulePermissions, params.role)
  const rulePermissions = normalizeRulePermissions(params.rulePermissions, params.role)

  await executeSql('DELETE FROM usuario_modulo_permissoes WHERE user_id = ?', [params.userId], executor)
  await executeSql('DELETE FROM usuario_regra_permissoes WHERE user_id = ?', [params.userId], executor)

  for (const moduleKey of MODULE_KEYS) {
    await executeSql(
      `INSERT INTO usuario_modulo_permissoes (user_id, module_key, allowed)
       VALUES (?, ?, ?)`,
      [params.userId, moduleKey, modulePermissions[moduleKey]],
      executor
    )
  }

  for (const ruleKey of RULE_KEYS) {
    await executeSql(
      `INSERT INTO usuario_regra_permissoes (user_id, rule_key, allowed)
       VALUES (?, ?, ?)`,
      [params.userId, ruleKey, rulePermissions[ruleKey]],
      executor
    )
  }

  return {
    modulePermissions,
    rulePermissions,
  }
}

export async function syncNormalizedUserPermissionsWithPrisma(
  params: {
    userId: string
    role: RoleUsuario
    modulePermissions: unknown
    rulePermissions: unknown
  },
  tx: any
) {
  const modulePermissions = normalizeModulePermissions(params.modulePermissions, params.role)
  const rulePermissions = normalizeRulePermissions(params.rulePermissions, params.role)

  await tx.usuario_modulo_permissoes.deleteMany({ where: { user_id: params.userId } })
  await tx.usuario_regra_permissoes.deleteMany({ where: { user_id: params.userId } })

  await tx.usuario_modulo_permissoes.createMany({
    data: MODULE_KEYS.map((moduleKey) => ({
      user_id: params.userId,
      module_key: moduleKey,
      allowed: modulePermissions[moduleKey],
    })),
  })

  await tx.usuario_regra_permissoes.createMany({
    data: RULE_KEYS.map((ruleKey) => ({
      user_id: params.userId,
      rule_key: ruleKey,
      allowed: rulePermissions[ruleKey],
    })),
  })

  return {
    modulePermissions,
    rulePermissions,
  }
}
