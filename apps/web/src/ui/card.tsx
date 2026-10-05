import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from './cn'

const cardVariants = cva('min-w-0 rounded-card border text-text-primary', {
  variants: {
    variant: {
      default: 'grid gap-3 border-border-default bg-surface-raised p-4',
      compact: 'grid gap-2 border-border-default bg-surface-raised p-3',
      interactive:
        'block border-0 border-l-2 border-l-transparent bg-transparent p-0 text-text-secondary transition-colors hover:bg-surface-interactive data-[selected=true]:border-l-accent data-[selected=true]:bg-accent-subtle data-[selected=true]:text-text-primary motion-reduce:transition-none data-[attention=informational]:outline data-[attention=informational]:outline-info data-[attention=informational]:outline-dotted data-[attention=completed]:outline data-[attention=completed]:outline-success data-[attention=waiting]:outline-2 data-[attention=waiting]:outline-warning data-[attention=waiting]:outline-dashed data-[attention=urgent]:outline-2 data-[attention=urgent]:outline-destructive -outline-offset-2'
    }
  },
  defaultVariants: { variant: 'default' }
})

interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  asChild?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ asChild = false, className, variant, ...props }, ref) => {
    const Component = asChild ? Slot : 'div'
    return (
      <Component
        ref={ref}
        data-slot="card"
        className={cn(cardVariants({ variant }), className)}
        {...props}
      />
    )
  }
)
Card.displayName = 'Card'

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn('grid gap-1.5', className)} {...props} />
}

function CardTitle({
  asChild = false,
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'h3'
  return (
    <Component
      data-slot="card-title"
      className={cn('m-0 font-ui text-body font-semibold text-text-primary', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="card-description"
      className={cn('m-0 text-ui text-text-secondary', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn('min-w-0', className)} {...props} />
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cardVariants }
