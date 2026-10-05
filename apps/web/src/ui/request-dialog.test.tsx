// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'

import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { confirmAction, requestText, showMessage } from './request-dialog'

describe('shadcn dialog requests', () => {
  it('cancels a confirmation with Escape and restores focus', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const answer = confirmAction('Discard unsaved changes?')
    const dialog = await screen.findByRole('dialog', { name: 'Confirm action' })
    expect(dialog).toHaveTextContent('Discard unsaved changes?')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await act(async () => {
      expect(await answer).toBe(false)
    })
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps confirmation requests ordered and requires an explicit response', async () => {
    const first = confirmAction('Close the workspace?')
    const second = confirmAction('Delete the layout?')
    await screen.findByText('Close the workspace?')
    expect(screen.queryByText('Delete the layout?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await act(async () => {
      expect(await first).toBe(true)
    })
    await screen.findByText('Delete the layout?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      expect(await second).toBe(false)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('prefills and submits a text prompt', async () => {
    const answer = requestText('Rename workspace', 'Original')
    const input = await screen.findByRole('textbox', { name: 'Rename workspace' })
    expect(input).toHaveValue('Original')
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.submit(input.closest('form')!)
    await act(async () => {
      expect(await answer).toBe('New name')
    })
  })

  it('shows an informational message with an acknowledgement', async () => {
    const answer = showMessage('The workspace could not be opened.')
    await screen.findByText('The workspace could not be opened.')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await act(async () => {
      await answer
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
