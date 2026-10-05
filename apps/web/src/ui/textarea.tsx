import { forwardRef, type TextareaHTMLAttributes } from 'react'

import { cn } from './cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: 'default' | 'code'
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'min-h-20 w-full min-w-0 rounded-sm border border-border-default bg-surface-canvas px-2.5 py-2 font-ui text-ui text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 motion-reduce:transition-none',
        variant === 'code' && 'font-mono leading-prose',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
