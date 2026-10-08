import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'

import { cn } from './cn'

const Tabs = TabsPrimitive.Root

const tabVariants = cva(
  'inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm font-ui text-ui font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default:
          'min-h-[var(--aw-size-control-sm)] px-2.5 data-[state=active]:bg-surface-interactive data-[state=active]:text-text-primary',
        navigation:
          'min-h-[var(--aw-size-control-md)] justify-start border border-border-default bg-surface-raised px-2.5 text-text-secondary hover:bg-surface-interactive-hover data-[state=active]:border-accent data-[state=active]:bg-accent-subtle data-[state=active]:text-text-primary',
        pane: 'h-full rounded-none border-0 bg-transparent px-2 text-text-secondary data-[state=active]:text-text-primary'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { unstyled?: boolean }
>(({ className, unstyled = false, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      !unstyled &&
        'inline-flex min-h-[var(--aw-size-control-md)] items-center gap-0.5 rounded-md border border-border-default bg-surface-raised p-0.5 text-text-muted',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & VariantProps<typeof tabVariants>
>(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn(tabVariants({ variant }), className)} {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsContent, TabsList, TabsTrigger }
