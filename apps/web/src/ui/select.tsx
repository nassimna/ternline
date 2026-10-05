import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { forwardRef } from 'react'

import { cn } from './cn'

const Select = SelectPrimitive.Root
const SelectValue = SelectPrimitive.Value

const SelectTrigger = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    className={cn(
      'flex h-[var(--aw-size-control-md)] w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-border-default bg-surface-canvas px-2.5 font-ui text-ui text-text-primary transition-colors hover:border-border-strong focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 motion-reduce:transition-none [&>span]:truncate',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', sideOffset = 5, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={sideOffset}
      className={cn(
        'relative max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border-default bg-surface-overlay text-text-primary shadow-popup [z-index:var(--aw-z-popover)]',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center">
        <ChevronUp aria-hidden="true" className="size-3.5" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center">
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-7 cursor-default items-center rounded-sm py-1 pr-7 pl-2 font-ui text-ui outline-none select-none focus:bg-surface-interactive-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check aria-hidden="true" className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
