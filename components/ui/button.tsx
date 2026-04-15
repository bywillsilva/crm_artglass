import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const DEFAULT_AUTO_LOCK_MS = 1000

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  onClick,
  pending = false,
  disableAutoLock = false,
  autoLockMs = DEFAULT_AUTO_LOCK_MS,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    pending?: boolean
    disableAutoLock?: boolean
    autoLockMs?: number
  }) {
  const Comp = asChild ? Slot : 'button'
  const [isLocked, setIsLocked] = React.useState(false)
  const unlockTimeoutRef = React.useRef<number | null>(null)
  const isDisabled = Boolean(disabled || pending || isLocked)

  React.useEffect(() => {
    return () => {
      if (unlockTimeoutRef.current !== null) {
        window.clearTimeout(unlockTimeoutRef.current)
      }
    }
  }, [])

  const scheduleUnlock = () => {
    if (unlockTimeoutRef.current !== null) {
      window.clearTimeout(unlockTimeoutRef.current)
    }

    unlockTimeoutRef.current = window.setTimeout(() => {
      setIsLocked(false)
      unlockTimeoutRef.current = null
    }, autoLockMs)
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      event.preventDefault()
      return
    }

    if (!disableAutoLock && !asChild) {
      setIsLocked(true)
    }

    try {
      const result = onClick?.(event)

      if (disableAutoLock || asChild) {
        return result
      }

      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(result).finally(() => {
          setIsLocked(false)
          if (unlockTimeoutRef.current !== null) {
            window.clearTimeout(unlockTimeoutRef.current)
            unlockTimeoutRef.current = null
          }
        })
        return result
      }

      scheduleUnlock()
      return result
    } catch (error) {
      setIsLocked(false)
      if (unlockTimeoutRef.current !== null) {
        window.clearTimeout(unlockTimeoutRef.current)
        unlockTimeoutRef.current = null
      }
      throw error
    }
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={pending || isLocked}
      disabled={asChild ? undefined : isDisabled}
      onClick={handleClick}
      {...props}
    />
  )
}

export { Button, buttonVariants }
