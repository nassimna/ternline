import { fireEvent, screen } from '@testing-library/react'

/** Open the Radix select with the keyboard and choose an accessible option. */
export async function chooseSelectOption(trigger: HTMLElement, name: string): Promise<void> {
  // jsdom does not implement scrolling; Radix scrolls the focused option into view.
  if (!('scrollIntoView' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined
    })
  }
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const option = await screen.findByRole('option', { name })
  option.focus()
  fireEvent.keyDown(option, { key: 'Enter' })
}
