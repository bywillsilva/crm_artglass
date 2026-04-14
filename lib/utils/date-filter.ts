import { formatDateOnlyLocalValue, parseDateTimeValue } from '@/lib/utils/date-time'

export type DateFilterPreset =
  | 'current_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'current_year'
  | 'custom'

export interface DateFilterValue {
  preset: DateFilterPreset
  startDate: string
  endDate: string
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() - days)
  return next
}

export function getDateRangeFromPreset(
  preset: DateFilterPreset,
  now = new Date()
): DateFilterValue {
  switch (preset) {
    case 'last_30_days':
      return {
        preset,
        startDate: formatDateOnlyLocalValue(subtractDays(now, 29)),
        endDate: formatDateOnlyLocalValue(now),
      }
    case 'last_90_days':
      return {
        preset,
        startDate: formatDateOnlyLocalValue(subtractDays(now, 89)),
        endDate: formatDateOnlyLocalValue(now),
      }
    case 'current_year':
      return {
        preset,
        startDate: formatDateOnlyLocalValue(startOfYear(now)),
        endDate: formatDateOnlyLocalValue(now),
      }
    case 'custom':
      return {
        preset,
        startDate: formatDateOnlyLocalValue(startOfMonth(now)),
        endDate: formatDateOnlyLocalValue(endOfMonth(now)),
      }
    case 'current_month':
    default:
      return {
        preset: 'current_month',
        startDate: formatDateOnlyLocalValue(startOfMonth(now)),
        endDate: formatDateOnlyLocalValue(endOfMonth(now)),
      }
  }
}

export function createDefaultDateFilter(now = new Date()) {
  return getDateRangeFromPreset('current_month', now)
}

export function normalizeDateFilter(value: DateFilterValue): DateFilterValue {
  if (!value.startDate || !value.endDate) {
    return createDefaultDateFilter()
  }

  if (value.startDate <= value.endDate) {
    return value
  }

  return {
    ...value,
    startDate: value.endDate,
    endDate: value.startDate,
  }
}

export function isWithinDateFilter(
  value: string | Date | null | undefined,
  filter: DateFilterValue
) {
  if (!value) return false

  const current = parseDateTimeValue(value).getTime()
  const start = parseDateTimeValue(`${filter.startDate}T00:00:00`).getTime()
  const end = parseDateTimeValue(`${filter.endDate}T23:59:59`).getTime()

  return current >= start && current <= end
}

export function getDateFilterQueryParams(filter: DateFilterValue) {
  const normalized = normalizeDateFilter(filter)
  return new URLSearchParams({
    startDate: normalized.startDate,
    endDate: normalized.endDate,
  }).toString()
}
