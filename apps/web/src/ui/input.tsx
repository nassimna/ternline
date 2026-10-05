import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from './cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'embedded'
  controlSize?: 'default' | 'small'
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', controlSize = 'default', ...props }, ref) => (
    <input
      ref={ref}
      data-slot="input"
      type={type}
      className={cn(
        'h-[var(--aw-size-control-md)] w-full min-w-0 rounded-sm border border-border-default bg-surface-canvas px-2.5 font-ui text-ui text-text-primary shadow-none transition-colors placeholder:text-text-muted hover:border-border-strong focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 motion-reduce:transition-none',
        controlSize === 'small' && 'h-[var(--aw-size-control-sm)]',
        variant === 'embedded' && 'h-full border-0 bg-transparent px-0 focus-visible:ring-0',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
