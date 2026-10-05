import type { HTMLAttributes } from 'react'

import { cn } from './cn'

function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'rounded-xs border border-border-strong bg-surface-raised px-1.5 py-0.5 font-mono text-metadata text-text-muted',
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
