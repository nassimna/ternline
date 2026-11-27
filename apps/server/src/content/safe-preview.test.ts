import { safeMarkdownDocumentSchema } from '@agent-workspace/protocol-client'
import { describe, expect, it } from 'vitest'

import { boundedDiff, parseSafeMarkdown, previewLines } from './safe-preview'

describe('preview lines', () => {
  it.each([
    ['LF', 'first\nsecond', ['first', 'second']],
    ['CRLF', 'first\r\nsecond\r\n', ['first', 'second']],
    ['mixed line endings', 'first\r\n\nlast\n', ['first', '', 'last']],
    ['empty input', '', []],
    ['blank input', '\n', ['']],
    ['trailing blank rows', 'first\n\n\n', ['first', '', '']],
    ['standalone carriage returns', 'first\rsecond\nlast\r', ['first\rsecond', 'last\r']],
    ['a carriage return before CRLF', 'first\r\r\nlast', ['first\r', 'last']]
  ])('splits %s into the expected rows', (_name, source, rows) => {
    expect(previewLines(source)).toStrictEqual(rows)
  })
})

describe('safe Markdown previews', () => {
  it('ignores a leading BOM and preserves U+FEFF inside paragraph text', () => {
    expect(parseSafeMarkdown('\uFEFF# Release notes\n\nReady to\uFEFF review.\n')).toStrictEqual([
      { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'Release notes' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Ready to\uFEFF review.' }] }
    ])
  })

  it.each([
    ['A ', ' and tail.'],
    ['A ', ''],
    ['', ' and tail.'],
    ['', ''],
    ['The marker ]( appears before ', '.']
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

  it.each(['the guide', 'Guide [draft]'])(
    'preserves bracketed prose before a link to %s',
    (label) => {
      const href = 'https://example.com/guide'
      expect(parseSafeMarkdown(`Choose [preview] or [${label}](${href}).`)).toEqual([
        {
          kind: 'paragraph',
          children: [
            { kind: 'text', text: 'Choose [preview] or ' },
            { kind: 'link', label, href },
            { kind: 'text', text: '.' }
          ]
        }
      ])
    }
  )

  it('keeps a link with an escaped opening bracket as literal text', () => {
    const source = String.raw`Literal \[preview](https://example.com/preview).`

    expect(parseSafeMarkdown(source)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: source }] }
    ])
  })

  it.each([
    ['an escaped link', String.raw`Use \[preview](https://example.com/preview) or `],
    [
      'bracketed prose and an escaped link',
      String.raw`Use [preview] then \[draft](https://example.com/draft) or `
    ],
    ['an even run of backslashes', String.raw`Use \\`]
  ])('finds a link after %s', (_name, prefix) => {
    const href = 'https://example.com/guide'

    expect(parseSafeMarkdown(`${prefix}[the guide](${href}).`)).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: prefix },
          { kind: 'link', label: 'the guide', href },
          { kind: 'text', text: '.' }
        ]
      }
    ])
  })

  it('preserves escaped brackets in a link label', () => {
    const label = String.raw`Use \] or \[ in substitutions`
    const href = 'https://example.com/guide'

    expect(parseSafeMarkdown(`See [${label}](${href}).`)).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'See ' },
          { kind: 'link', label, href },
          { kind: 'text', text: '.' }
        ]
      }
    ])
  })

  it('preserves an escaped link delimiter inside a link label', () => {
    const label = String.raw`Array\](draft) reference`
    const href = 'https://example.com/reference'

    expect(parseSafeMarkdown(`Check [${label}](${href}).`)).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'Check ' },
          { kind: 'link', label, href },
          { kind: 'text', text: '.' }
        ]
      }
    ])
  })

  it('keeps an escaped link delimiter as literal text', () => {
    const source = String.raw`Keep [literal\](https://example.com/reference).`

    expect(parseSafeMarkdown(source)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: source }] }
    ])
  })

  it('parses a link delimiter after an even run of backslashes', () => {
    const label = String.raw`reference\\`
    const href = 'https://example.com/reference'

    expect(parseSafeMarkdown(`[${label}](${href})`)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'link', label, href }] }
    ])
  })

  it.each(['https://example.com/docs', 'https://example.com/docs(v2(draft))'])(
    'preserves trailing parentheses after a link to %s',
    (href) => {
      expect(parseSafeMarkdown(`Read [the guide](${href}) (updated).`)).toEqual([
        {
          kind: 'paragraph',
          children: [
            { kind: 'text', text: 'Read ' },
            { kind: 'link', label: 'the guide', href },
            { kind: 'text', text: ' (updated).' }
          ]
        }
      ])
    }
  )

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
    'A [link](../guide.md) and tail.',
    'A [link](#section) and tail.',
    'A [link](https://) and tail.',
    'A [link](HTTPS://example.com) and tail.',
    '<b>A</b> [link](https://example.com) and tail.'
  ])('keeps unsupported links or HTML-containing input literal (%s)', (source) => {
    expect(parseSafeMarkdown(source)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: source }] }
    ])
  })

  it('accepts link labels and hrefs up to 2048 UTF-16 code units each', () => {
    const label = '😀'.repeat(1024)
    const hrefPrefix = 'https://example.com/'
    const href = `${hrefPrefix}${'a'.repeat(2046 - hrefPrefix.length)}😀`

    expect(parseSafeMarkdown(`[${label}](${href})`)).toEqual([
      { kind: 'paragraph', children: [{ kind: 'link', label, href }] }
    ])

    for (const source of [`[${label}a](${href})`, `[${label}](${href}a)`]) {
      expect(parseSafeMarkdown(source)).toEqual([
        { kind: 'paragraph', children: [{ kind: 'text', text: source }] }
      ])
    }
  })

  it.each([
    ['no suffix', ''],
    ['two spaces', '  '],
    ['a tab', '\t']
  ])('closes a code block when its closing fence has %s', (_name, suffix) => {
    const source = ['```sh', 'echo hello', '```' + suffix, '', 'Outside the fence.'].join('\n')

    expect(parseSafeMarkdown(source)).toStrictEqual([
      { kind: 'codeBlock', language: 'sh', text: 'echo hello' },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Outside the fence.' }] }
    ])
  })

  it('keeps a fence followed by text inside the code block', () => {
    const source = ['```sh', 'echo hello', '``` still code', '```'].join('\n')

    expect(parseSafeMarkdown(source)).toStrictEqual([
      { kind: 'codeBlock', language: 'sh', text: 'echo hello\n``` still code' }
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
      name: 'preserves a final bare carriage return and treats LF and CRLF alike',
      before: 'first\r\nlast',
      after: 'first\nlast\r',
      lines: [
        { kind: 'removed', text: 'last' },
        { kind: 'context', text: 'first' },
        { kind: 'added', text: 'last\r' }
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
    ['keeps an exact-fit row ending in a pair', 16_382, '😀', '😀', false],
    ['keeps a pair at the end of the clipped text', 16_382, '😀x', '😀', true],
    ['omits a pair that crosses the limit', 16_383, '😀', '', true],
    ['truncates a BMP suffix at the limit', 16_383, 'éx', 'é', true],
    ['keeps an isolated high surrogate at the limit', 16_383, '\uD83Dx', '\uD83D', true]
  ])('%s', (_name, prefixLength, suffix, retainedSuffix, truncated) => {
    const prefix = 'a'.repeat(prefixLength)
    const result = boundedDiff('', prefix + suffix)
    expect(result.lines).toStrictEqual([{ kind: 'added', text: prefix + retainedSuffix }])
    expect(result.truncated).toBe(truncated)
  })

  it.each([
    ['removed', 'old', '', ['removed']],
    ['context', 'old', 'old', ['context']],
    ['replacement', 'old', 'new', ['removed', 'added']]
  ])('reports clipped %s text', (_name, before, after, kinds) => {
    const prefix = 'x'.repeat(16_384)
    const result = boundedDiff(prefix + before, after ? prefix + after : '')

    expect(result.lines).toStrictEqual(kinds.map((kind) => ({ kind, text: prefix })))
    expect(result.truncated).toBe(true)
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

  it.each([
    ['\nold tail', '\r\nnew tail'],
    ['', '\r\nnew tail'],
    ['\nold tail', '']
  ])('returns the shared visible prefix with hidden tails %j and %j', (beforeTail, afterTail) => {
    const clipped = 'x'.repeat(16_383)
    const rows = Array.from({ length: 2047 }, (_, index) => `row ${index % 2}`)
    const lastRow = clipped + '😀'
    const before = rows.map((row, index) => row + (index % 2 === 0 ? '\r\n' : '\n')).join('')

    expect(
      boundedDiff(before + lastRow + beforeTail, [...rows, lastRow].join('\n') + afterTail)
    ).toStrictEqual({
      lines: [...rows, clipped].map((text) => ({ kind: 'context', text })),
      truncated: true
    })
  })

  it('matches a differing visible row against rows beyond the opposite preview limit', () => {
    const sharedRows = 'same\n'.repeat(2047)
    const clipped = 'x'.repeat(16_384)
    const oldRow = `${clipped}old`
    const newRow = `${clipped}new`

    expect(boundedDiff(sharedRows + oldRow, `${sharedRows}${newRow}\n${oldRow}`)).toStrictEqual({
      lines: [
        ...Array.from({ length: 2047 }, () => ({ kind: 'context', text: 'same' })),
        { kind: 'added', text: clipped }
      ],
      truncated: true
    })
  })

  it('uses hidden matches in both long inputs before marking excess visible duplicates', () => {
    const sharedRows = Array.from({ length: 2043 }, () => 'shared')
    const hiddenRows = Array.from({ length: 2048 }, (_, index) => `hidden ${index}`)
    const before = ['moved out', 'moved out', 'old', 'moved out', '', ...sharedRows, ...hiddenRows]
    const after = ['moved in', 'moved in', 'new', 'moved in', '', ...sharedRows, ...hiddenRows]

    expect(
      boundedDiff(
        [...before, 'moved in', 'moved in'].join('\r\n'),
        [...after, 'moved out', 'moved out'].join('\n')
      )
    ).toStrictEqual({
      lines: [
        { kind: 'removed', text: 'old' },
        { kind: 'removed', text: 'moved out' },
        { kind: 'context', text: 'moved in' },
        { kind: 'context', text: 'moved in' },
        { kind: 'added', text: 'new' },
        { kind: 'added', text: 'moved in' },
        { kind: 'context', text: '' },
        ...sharedRows.map((text) => ({ kind: 'context', text }))
      ],
      truncated: true
    })
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
