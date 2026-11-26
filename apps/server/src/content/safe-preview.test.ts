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
    {
      name: 'removes a duplicate',
      before: 'retry\nretry\n',
      after: 'retry\n',
      lines: [
        { kind: 'removed', text: 'retry' },
        { kind: 'context', text: 'retry' }
      ]
    },
    {
      name: 'adds a duplicate',
      before: 'retry\n',
      after: 'retry\nretry\n',
      lines: [
        { kind: 'context', text: 'retry' },
        { kind: 'added', text: 'retry' }
      ]
    },
    {
      name: 'matches the first occurrences and preserves scan order',
      before: 'retry\nold\nanchor\nretry\nretry\n',
      after: 'retry\nanchor\nretry\nretry\nretry\nretry\n',
      lines: [
        { kind: 'removed', text: 'old' },
        { kind: 'context', text: 'retry' },
        { kind: 'context', text: 'anchor' },
        { kind: 'context', text: 'retry' },
        { kind: 'context', text: 'retry' },
        { kind: 'added', text: 'retry' },
        { kind: 'added', text: 'retry' }
      ]
    }
  ])('$name', ({ before, after, lines }) => {
    expect(boundedDiff(before, after)).toStrictEqual({ lines, truncated: false })
  })

  it.each([
    [2048, 2048, false],
    [2049, 2049, true],
    [2049, 1, true],
    [1, 2049, true]
  ])('reports omitted input lines (%i before, %i after)', (beforeCount, afterCount, truncated) => {
    const result = boundedDiff('same\n'.repeat(beforeCount), 'same\n'.repeat(afterCount))
    const beforeScanCount = Math.min(beforeCount, 2048)
    const afterScanCount = Math.min(afterCount, 2048)
    expect(result.lines).toEqual([
      ...Array.from({ length: Math.max(0, beforeScanCount - afterCount) }, () => ({
        kind: 'removed',
        text: 'same'
      })),
      ...Array.from({ length: Math.min(beforeCount, afterScanCount) }, () => ({
        kind: 'context',
        text: 'same'
      })),
      ...Array.from({ length: Math.max(0, afterScanCount - beforeCount) }, () => ({
        kind: 'added',
        text: 'same'
      }))
    ])
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
