import { Command as CommandPrimitive, useCommandState } from 'cmdk'
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

import { cn } from './cn'

const Command = forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    data-slot="command"
    className={cn('flex min-w-0 flex-col bg-surface-overlay text-text-primary', className)}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandInput = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const activeValue = useCommandState((state) => state.value)
  const [activeId, setActiveId] = useState<string>()
  useImperativeHandle(ref, () => inputRef.current!, [])
  useLayoutEffect(() => {
    // cmdk 1.1.1 does not populate selectedItemId for its initial selection.
    // Keep the combobox linked to the selected option from the first render too.
    const selected = inputRef.current
      ?.closest('[cmdk-root]')
      ?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
    setActiveId(selected?.id)
  }, [activeValue, props.value])
  return (
    <CommandPrimitive.Input
      ref={inputRef}
      asChild
      data-slot="command-input"
      className={cn(
        'h-[var(--aw-size-control-md)] w-full min-w-0 bg-transparent font-ui text-ui text-text-primary outline-none placeholder:text-text-muted',
        className
      )}
      {...props}
    >
      <input aria-activedescendant={activeId} />
    </CommandPrimitive.Input>
  )
})
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    data-slot="command-list"
    className={cn('min-w-0 overflow-x-hidden overflow-y-auto', className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandItem = forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    data-slot="command-item"
    className={cn(
      'flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-ui outline-none data-[selected=true]:bg-surface-interactive-hover data-[selected=true]:text-text-primary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      className
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

export { Command, CommandInput, CommandItem, CommandList }
