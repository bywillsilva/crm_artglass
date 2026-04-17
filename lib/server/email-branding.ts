import { query } from '@/lib/db/mysql'

let cachedBranding: { appName: string; cachedAt: number } | null = null
const BRANDING_CACHE_MS = 60_000

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

    const parsed =
      typeof config?.valor === 'string'
        ? JSON.parse(config.valor)
        : config?.valor && typeof config.valor === 'object'
          ? config.valor
          : null

    const appName =
      typeof parsed?.nome === 'string' && parsed.nome.trim() ? parsed.nome.trim() : fallbackName

    cachedBranding = { appName, cachedAt: now }
    return cachedBranding
  } catch {
    cachedBranding = { appName: fallbackName, cachedAt: now }
    return cachedBranding
  }
}
