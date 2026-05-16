function isDecimalLike(value: unknown) {
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) {
    return false
  }

  const maybeDecimal = value as {
    constructor?: { name?: string }
    toNumber?: () => number
    toString?: () => string
  }

  return (
    maybeDecimal.constructor?.name === 'Decimal' ||
    (typeof maybeDecimal.toNumber === 'function' && typeof maybeDecimal.toString === 'function')
  )
}

function normalizeDecimalLike(value: unknown) {
  const maybeDecimal = value as {
    toNumber?: () => number
    toString?: () => string
  }

  if (typeof maybeDecimal.toNumber === 'function') {
    const parsed = maybeDecimal.toNumber()
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  if (typeof maybeDecimal.toString === 'function') {
    const parsed = Number(maybeDecimal.toString())
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

export function normalizeJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (isDecimalLike(value)) {
    return normalizeDecimalLike(value)
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, normalizeJsonValue(entryValue)])
    )
  }

  return value
}

export function normalizeJsonPayload<T>(value: T): T {
  return normalizeJsonValue(value) as T
}
