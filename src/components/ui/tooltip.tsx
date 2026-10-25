import type { ComponentProps } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

/** Show hover and focus details in a viewport-aware portal without resizing list rows. */
export function TooltipContent({
  className,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'z-50 max-h-[var(--radix-tooltip-content-available-height)] max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-card px-3 py-2 text-xs leading-5 text-card-foreground shadow-lg',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
