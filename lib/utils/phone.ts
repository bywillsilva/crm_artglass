const BRAZIL_PHONE_MAX_DIGITS = 11

export function normalizePhoneDigits(value: string | null | undefined) {
  return String(value || '').replace(/\D/g, '').slice(0, BRAZIL_PHONE_MAX_DIGITS)
}

export function formatBrazilPhone(value: string | null | undefined) {
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''

  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`
}

export function isValidBrazilPhone(value: string | null | undefined) {
  const digits = normalizePhoneDigits(value)
  return digits.length === 10 || digits.length === 11
}
