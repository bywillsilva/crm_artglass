export const CLIENT_ORIGIN_OPTIONS = [
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'site', label: 'Site' },
  { value: 'indicacao', label: 'Indicacao' },
  { value: 'prospeccao', label: 'Prospeccao' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'outro', label: 'Outro' },
] as const

export type ClientOrigin = (typeof CLIENT_ORIGIN_OPTIONS)[number]['value']

const CLIENT_ORIGIN_VALUES = new Set<string>(CLIENT_ORIGIN_OPTIONS.map((option) => option.value))

function normalizeComparableText(value: unknown) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function normalizeClientOrigin(value: unknown): ClientOrigin | null {
  const normalized = normalizeComparableText(value)
  if (!normalized || normalized === 'nao_informado') return null

  const aliases: Record<string, ClientOrigin> = {
    google: 'google_ads',
    google_ads: 'google_ads',
    ads: 'google_ads',
    facebook: 'facebook',
    instagram: 'instagram',
    site: 'site',
    indicacao: 'indicacao',
    indicacao_de_cliente: 'indicacao',
    prospeccao: 'prospeccao',
    prospeccao_ativa: 'prospeccao',
    telefone: 'telefone',
    outro: 'outro',
  }

  if (aliases[normalized]) return aliases[normalized]
  if (CLIENT_ORIGIN_VALUES.has(normalized)) return normalized as ClientOrigin
  return 'outro'
}

export function getClientOriginLabel(value: unknown) {
  const normalized = normalizeClientOrigin(value)
  return CLIENT_ORIGIN_OPTIONS.find((option) => option.value === normalized)?.label || 'Nao informado'
}
