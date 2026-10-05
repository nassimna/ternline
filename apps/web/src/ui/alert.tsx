import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from './cn'

const alertVariants = cva('relative w-full rounded-md border p-3 font-ui text-ui', {
  variants: {
    variant: {
      default: 'border-border-default bg-surface-raised text-text-secondary',
      destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
      warning: 'border-warning/50 bg-warning/10 text-warning'
    }
  },
  defaultVariants: { variant: 'default' }
})

function Alert({
  asChild = false,
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'div'
  return (
    <Component
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert }
