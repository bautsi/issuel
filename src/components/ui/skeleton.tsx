import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Reserve content space while data loads without exposing stale repository content. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'rounded-md bg-accent motion-safe:animate-pulse',
        className,
      )}
      {...props}
    />
  )
}
