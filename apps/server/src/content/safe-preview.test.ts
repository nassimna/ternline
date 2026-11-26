import { describe, expect, it } from 'vitest'

import { boundedDiff, parseSafeMarkdown } from './safe-preview'

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

describe('bounded diffs', () => {
  it.each([
    [2048, 2048, false],
    [2049, 2049, true],
    [2049, 1, true],
    [1, 2049, true]
  ])('reports omitted input lines (%i before, %i after)', (beforeCount, afterCount, truncated) => {
    const result = boundedDiff('same\n'.repeat(beforeCount), 'same\n'.repeat(afterCount))
    expect(result.lines).toEqual(
      Array.from({ length: Math.min(afterCount, 2048) }, () => ({ kind: 'context', text: 'same' }))
    )
    expect(result.truncated).toBe(truncated)
  })

  it('does not report truncation when all 4096 diff lines fit', () => {
    const result = boundedDiff('old\n'.repeat(2048), 'new\n'.repeat(2048))
    expect(result.lines).toEqual([
      ...Array.from({ length: 2048 }, () => ({ kind: 'removed', text: 'old' })),
      ...Array.from({ length: 2048 }, () => ({ kind: 'added', text: 'new' }))
    ])
    expect(result.truncated).toBe(false)
  })
})
