import * as ProgressPrimitive from '@radix-ui/react-progress'
import { forwardRef } from 'react'

import { cn } from './cn'

const Progress = forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    data-slot="progress"
    className={cn('relative h-1 w-full overflow-hidden rounded-full bg-border-default', className)}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className="h-full w-full bg-accent transition-transform data-[state=indeterminate]:animate-pulse motion-reduce:transition-none motion-reduce:animate-none"
      style={{ transform: value == null ? undefined : `translateX(-${String(100 - value)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
