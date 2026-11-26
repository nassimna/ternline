import { safeMarkdownDocumentSchema } from '@agent-workspace/protocol-client'
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

  it('parses a link after http in the surrounding text', () => {
    expect(parseSafeMarkdown('Use http or [the secure version](https://example.com).')).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Use http or ' },
          { kind: 'link', label: 'the secure version', href: 'https://example.com' },
          { kind: 'text', text: '.' }
        ]
      }
    ])
  })

  it('parses a link with http in its label', () => {
    expect(parseSafeMarkdown('[Learn about http](https://example.com).')).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'link', label: 'Learn about http', href: 'https://example.com' },
          { kind: 'text', text: '.' }
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

  it('bounds fenced code language and text at their UTF-16 limits', () => {
    const languagePrefix = 'a'.repeat(31)
    const rows = `${'a'.repeat(16_384)}\n`.repeat(3)
    const finalRowPrefix = 'b'.repeat(16_380)
    const source = `\`\`\`${languagePrefix}😀\n${rows}${finalRowPrefix}😀\n\`\`\``

    expect(parseSafeMarkdown(source)).toStrictEqual([
      { kind: 'codeBlock', language: languagePrefix, text: `${rows}${finalRowPrefix}` }
    ])
  })

  it('returns exactly 2048 complete paragraphs from 2049 plain rows', () => {
    const rows = Array.from({ length: 2049 }, (_, index) => `row ${index + 1}`)
    const nodes = safeMarkdownDocumentSchema.shape.nodes.parse(parseSafeMarkdown(rows.join('\n')))

    expect(nodes).toEqual(
      rows.slice(0, 2048).map((text) => ({ kind: 'paragraph', children: [{ kind: 'text', text }] }))
    )
  })

  it('counts mixed blocks and stops at the first block that exceeds the budget', () => {
    const prefix = `${'row\n'.repeat(2044)}# A [link](https://example.com) here\n- item\n\n`
    const code = '```ts\nconst value = 1\n```'
    const nodes = safeMarkdownDocumentSchema.shape.nodes.parse(
      parseSafeMarkdown(`${prefix}${code}\n${code}`)
    )

    expect(nodes).toHaveLength(2047)
    expect(nodes.slice(2044)).toEqual([
      {
        kind: 'heading',
        level: 1,
        children: [
          { kind: 'text', text: 'A ' },
          { kind: 'link', label: 'link', href: 'https://example.com' },
          { kind: 'text', text: ' here' }
        ]
      },
      {
        kind: 'list',
        ordered: false,
        items: [{ kind: 'listItem', children: [{ kind: 'text', text: 'item' }] }]
      },
      { kind: 'codeBlock', language: 'ts', text: 'const value = 1' }
    ])
    expect(parseSafeMarkdown(`${prefix}too large\n${code}`)).toEqual(nodes.slice(0, -1))
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
    ['keeps a pair that fits exactly', 16_382, '😀x', '😀'],
    ['omits a pair that crosses the limit', 16_383, '😀', ''],
    ['truncates a BMP suffix at the limit', 16_383, 'éx', 'é'],
    ['keeps an isolated high surrogate at the limit', 16_383, '\uD83Dx', '\uD83D']
  ])('%s', (_name, prefixLength, suffix, retainedSuffix) => {
    const prefix = 'a'.repeat(prefixLength)
    expect(boundedDiff('', prefix + suffix)).toStrictEqual({
      lines: [{ kind: 'added', text: prefix + retainedSuffix }],
      truncated: false
    })
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
