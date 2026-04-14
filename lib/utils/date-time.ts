export function parseDateTimeValue(value?: string | Date | null) {
  if (!value) return new Date()
  if (value instanceof Date) return value

  const normalized = String(value).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    const [datePart, timePart] = normalized.split(' ')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes, seconds] = timePart.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes, seconds)
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    const [datePart, timePart] = normalized.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes] = timePart.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes, 0)
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    const [datePart, timePart] = normalized.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes, seconds] = timePart.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes, seconds)
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(normalized)) {
    const cleaned = normalized.replace('Z', '')
    const [datePart, timePart] = cleaned.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours, minutes, secondsWithMs] = timePart.split(':')
    const [seconds] = secondsWithMs.split('.')
    return new Date(year, month - 1, day, Number(hours), Number(minutes), Number(seconds || 0))
  }

  return new Date(normalized.replace(' ', 'T'))
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
