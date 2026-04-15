export function parseDateTimeValue(value?: string | Date | null) {
  if (!value) return new Date()
  if (value instanceof Date) return value

  const normalized = String(value).trim()
  const localDateTimeMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/
  )

  if (localDateTimeMatch) {
    const [, year, month, day, hours = '0', minutes = '0', seconds = '0', milliseconds = '0'] =
      localDateTimeMatch
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds.padEnd(3, '0'))
    )
  }

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const isoDate = new Date(normalized)
    if (!Number.isNaN(isoDate.getTime())) {
      return isoDate
    }
  }

  const parsedDate = new Date(normalized)
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate
  }

  const fallbackDate = new Date(normalized.replace(' ', 'T'))
  return Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function formatMysqlDateTimeValue(value?: string | Date | null) {
  const date = parseDateTimeValue(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDateOnlyLocalValue(value?: string | Date | null) {
  const date = parseDateTimeValue(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateTimeLocalInputValue(value?: string | Date | null) {
  const date = parseDateTimeValue(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
