import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from './cn'

const badgeVariants = cva(
  'inline-flex max-w-full min-w-0 shrink-0 items-center justify-center gap-1 rounded-full border font-ui font-medium whitespace-nowrap data-[attention=informational]:border-dotted data-[attention=waiting]:border-dashed data-[attention=urgent]:border-2',
  {
    variants: {
      variant: {
        secondary: 'border-border-default bg-surface-interactive text-text-secondary',
        outline: 'border-border-default bg-transparent text-text-secondary',
        info: 'border-info/50 bg-info/10 text-info',
        success: 'border-success/50 bg-success/10 text-success',
        warning: 'border-warning/50 bg-warning/10 text-warning',
        destructive: 'border-destructive/50 bg-destructive/10 text-destructive'
      },
      size: { default: 'min-h-5 px-1.5 text-metadata', small: 'min-h-4 px-1 text-metadata' }
    },
    defaultVariants: { variant: 'secondary', size: 'default' }
  }
)

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

function Badge({ asChild = false, className, size, variant, ...props }: BadgeProps) {
  const Component = asChild ? Slot : 'span'
  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ size, variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeProps }
