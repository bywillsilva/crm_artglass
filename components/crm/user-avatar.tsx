'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const FALLBACK_COLORS = [
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#14B8A6',
  '#F97316',
  '#64748B',
]

type UserAvatarProps = {
  name?: string | null
  initials?: string | null
  color?: string | null
  className?: string
  fallbackClassName?: string
  title?: string
}

function getInitials(name?: string | null, initials?: string | null) {
  const explicit = String(initials || '').trim().toUpperCase().slice(0, 2)
  if (explicit) return explicit

  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '??'
  return parts.map((part) => part[0]).join('').toUpperCase().slice(0, 2)
}

function getStableColor(seed?: string | null) {
  const source = String(seed || 'usuario')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

function normalizeColor(color?: string | null, seed?: string | null) {
  const value = String(color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value
  }
  return getStableColor(seed)
}

export function UserAvatar({
  name,
  initials,
  color,
  className,
  fallbackClassName,
  title,
}: UserAvatarProps) {
  const label = getInitials(name, initials)
  const backgroundColor = normalizeColor(color, name || initials)

  return (
    <Avatar className={cn('h-8 w-8', className)} title={title || name || label}>
      <AvatarFallback
        className={cn('text-xs font-bold text-white shadow-inner', fallbackClassName)}
        style={{ backgroundColor }}
      >
        {label}
      </AvatarFallback>
    </Avatar>
  )
}

type UserIdentityProps = UserAvatarProps & {
  label?: string | null
  textClassName?: string
}

export function UserIdentity({
  label,
  name,
  initials,
  color,
  className,
  fallbackClassName,
  textClassName,
}: UserIdentityProps) {
  const displayName = label ?? name ?? '-'
  const hasUser = Boolean(String(displayName || '').trim() && displayName !== '-')

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {hasUser ? (
        <UserAvatar
          name={name || displayName}
          initials={initials}
          color={color}
          className={className}
          fallbackClassName={fallbackClassName}
        />
      ) : null}
      <span className={cn('truncate', textClassName)}>{displayName || '-'}</span>
    </span>
  )
}
