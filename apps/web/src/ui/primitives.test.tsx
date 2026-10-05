// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CirclePlus } from 'lucide-react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from './button'
import { cn } from './cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './context-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog'
import { IconButton } from './icon-button'
import { Input } from './input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { chooseSelectOption } from '../test/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(cleanup)

describe('UI primitives', () => {
  it('keeps semantic type sizes separate from text colors when merging variants', () => {
    expect(cn('text-ui text-text-primary', 'text-body text-text-secondary')).toBe(
      'text-body text-text-secondary'
    )
    expect(cn('font-ui font-medium')).toBe('font-ui font-medium')
  })
  it('forwards refs and preserves native button behavior', async () => {
    const user = userEvent.setup()
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()

    render(
      <Button ref={ref} onClick={onClick}>
        Create
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Create' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'button')

    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('requires an accessible name for icon-only actions', () => {
    render(
      <IconButton aria-label="Create workspace">
        <CirclePlus aria-hidden="true" />
      </IconButton>
    )

    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeVisible()
  })

  it('exposes invalid and disabled native input states', () => {
    render(<Input aria-label="Workspace name" aria-invalid="true" disabled />)

    const input = screen.getByRole('textbox', { name: 'Workspace name' })
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('opens a named modal dialog and provides a labelled close control', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open settings</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>Change settings for this workspace.</DialogDescription>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeVisible()
  })

  it('opens a pointer-positioned context menu and supports keyboard selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button>Workspace</Button>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="Workspace actions">
          <ContextMenuItem onSelect={onSelect}>Duplicate workspace</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Workspace' }))
    const item = await screen.findByRole('menuitem', { name: 'Duplicate workspace' })
    expect(screen.getByRole('menu', { name: 'Workspace actions' })).toBeVisible()

    item.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('chooses a select option with the keyboard and returns focus to the trigger', async () => {
    const onValueChange = vi.fn()
    render(
      <Select defaultValue="comfortable" onValueChange={onValueChange}>
        <SelectTrigger aria-label="Density">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="comfortable">Comfortable</SelectItem>
          <SelectItem value="compact">Compact</SelectItem>
          <SelectItem value="expanded">Expanded</SelectItem>
        </SelectContent>
      </Select>
    )
    const trigger = screen.getByRole('combobox', { name: 'Density' })
    await chooseSelectOption(trigger, 'Expanded')
    expect(onValueChange).toHaveBeenCalledWith('expanded')
    expect(trigger).toHaveTextContent('Expanded')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('provides keyboard-operable tab semantics', async () => {
    const user = userEvent.setup()

    render(
      <Tabs defaultValue="terminal">
        <TabsList aria-label="Pane views">
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="terminal">Terminal content</TabsContent>
        <TabsContent value="details">Details content</TabsContent>
      </Tabs>
    )

    const terminalTab = screen.getByRole('tab', { name: 'Terminal' })
    const detailsTab = screen.getByRole('tab', { name: 'Details' })
    expect(terminalTab).toHaveAttribute('aria-selected', 'true')

    terminalTab.focus()
    await user.keyboard('{ArrowRight}')

    expect(detailsTab).toHaveFocus()
    expect(detailsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Details content')
  })
})
