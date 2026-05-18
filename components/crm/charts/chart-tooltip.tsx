'use client'

export const crmChartTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.75rem',
  boxShadow: '0 18px 45px rgb(0 0 0 / 0.35)',
  color: 'hsl(var(--popover-foreground))',
  padding: '0.75rem',
} as const

export const crmChartTooltipLabelStyle = {
  color: 'hsl(var(--foreground))',
  fontWeight: 700,
  marginBottom: '0.35rem',
} as const

export const crmChartTooltipItemStyle = {
  color: 'hsl(var(--muted-foreground))',
  fontSize: '0.75rem',
  fontWeight: 600,
} as const

export const crmChartTooltipCursorStyle = {
  fill: 'hsl(var(--muted) / 0.18)',
} as const

export function formatCountTooltip(value: number, label = 'Quantidade') {
  return [`${Number(value || 0)} item${Number(value || 0) === 1 ? '' : 's'}`, label]
}
