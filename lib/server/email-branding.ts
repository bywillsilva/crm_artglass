import { query } from '@/lib/db/mysql'

let cachedBranding: { appName: string; cachedAt: number } | null = null
const BRANDING_CACHE_MS = 60_000

function extractCompanyName(value: unknown) {
  if (!value) return null

  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        })()
      : typeof value === 'object'
        ? value
        : null

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const candidates = [
    (parsed as any).nome,
    (parsed as any).razaoSocial,
    (parsed as any).fantasia,
    (parsed as any).companyName,
    (parsed as any).appName,
    typeof (parsed as any).valor === 'object' ? (parsed as any).valor?.nome : null,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

export async function getEmailBranding() {
  const now = Date.now()
  if (cachedBranding && now - cachedBranding.cachedAt < BRANDING_CACHE_MS) {
    return cachedBranding
  }

  const fallbackName = process.env.APP_NAME || 'CRM'

  try {
    const [config] = await query<any[]>(
      `SELECT valor
       FROM configuracoes
       WHERE chave = 'empresa' AND scope = 'global' AND user_id = ''
       LIMIT 1`
    )

    const appName = extractCompanyName(config?.valor) || fallbackName

    cachedBranding = { appName, cachedAt: now }
    return cachedBranding
  } catch {
    cachedBranding = { appName: fallbackName, cachedAt: now }
    return cachedBranding
  }
}
