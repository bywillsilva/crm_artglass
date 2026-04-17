export function getDefaultRouteForRole(role?: string | null) {
  return role === 'orcamentista' ? '/funil' : '/dashboard'
}
