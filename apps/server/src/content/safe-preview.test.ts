import { describe, expect, it } from 'vitest'

import { parseSafeMarkdown } from './safe-preview'

describe('safe Markdown previews', () => {
  it.each([
    ['A ', ' and tail.'],
    ['A ', ''],
    ['', ' and tail.'],
    ['', '']
  ])('preserves text around a link (%j, %j)', (prefix, suffix) => {
    expect(parseSafeMarkdown(`${prefix}[link](https://example.com)${suffix}`)).toEqual([
      {
        kind: 'paragraph',
        children: [
          ...(prefix ? [{ kind: 'text', text: prefix }] : []),
          { kind: 'link', label: 'link', href: 'https://example.com' },
          ...(suffix ? [{ kind: 'text', text: suffix }] : [])
        ]
      }
    ])
  })

  it.each([
    'A [link](javascript:alert(1)) and tail.',
    'A [link](https://user:password@example.com) and tail.',
    '<b>A</b> [link](https://example.com) and tail.'
  ])('keeps unsafe or HTML-containing input literal (%s)', (source) => {
    expect(parseSafeMarkdown(source)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: source }] }
    ])
  })
})
