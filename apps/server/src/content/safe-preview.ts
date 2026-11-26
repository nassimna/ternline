import type { SafeMarkdownNode } from '@agent-workspace/protocol-client'

function takeCharacters(value: string, count: number): string {
  if (value.length <= count) return value

  let end = count
  const before = value.charCodeAt(end - 1)
  const after = value.charCodeAt(end)
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    end--
  }
  return value.slice(0, end)
}

// Rust str::lines removes the final empty row and the CR in CRLF.
export function previewLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function inlineNodes(value: string): SafeMarkdownNode[] {
  const bounded = takeCharacters(value, 16_384)
  if (!bounded.includes('<') && !bounded.includes('>')) {
    const a = bounded.indexOf('[')
    const b = bounded.indexOf('](')
    const c = bounded.lastIndexOf(')')
    if (a >= 0 && b > a && c > b) {
      const href = bounded.slice(b + 2, c)
      const label = bounded.slice(a + 1, b)
      try {
        const parsed = new URL(href)
        if (
          (href.startsWith('http://') || href.startsWith('https://')) &&
          !parsed.username &&
          !parsed.password &&
          href.length <= 2048 &&
          label.length <= 2048
        ) {
          const nodes: SafeMarkdownNode[] = [{ kind: 'link', label, href }]
          if (a > 0) nodes.unshift({ kind: 'text', text: bounded.slice(0, a) })
          if (c + 1 < bounded.length) nodes.push({ kind: 'text', text: bounded.slice(c + 1) })
          return nodes
        }
      } catch {
        // An unsafe or invalid link remains literal text.
      }
    }
  }
  return [{ kind: 'text', text: bounded }]
}

/** The same deliberately small, bounded Markdown grammar as workspace-content. */
export function parseSafeMarkdown(source: string): SafeMarkdownNode[] {
  const nodes: SafeMarkdownNode[] = []
  const lines = previewLines(source)
  for (let index = 0; index < lines.length && nodes.length < 4096; index++) {
    const line = lines[index]!
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const rows: string[] = []
      while (++index < lines.length && lines[index] !== '```') {
        rows.push(takeCharacters(lines[index]!, 16_384))
      }
      nodes.push({
        kind: 'codeBlock',
        language: language ? takeCharacters(language, 32) : null,
        text: takeCharacters(rows.join('\n'), 65_536)
      })
      continue
    }
    const hashes = /^#{1,6} /u.exec(line)?.[0].length
    if (hashes) {
      nodes.push({ kind: 'heading', level: hashes - 1, children: inlineNodes(line.slice(hashes)) })
    } else if (line.startsWith('- ')) {
      nodes.push({
        kind: 'list',
        ordered: false,
        items: [{ kind: 'listItem', children: inlineNodes(line.slice(2)) }]
      })
    } else if (line.trim()) {
      nodes.push({ kind: 'paragraph', children: inlineNodes(line) })
    }
  }
  return nodes
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

export function boundedDiff(before: string, after: string) {
  const beforeLines = previewLines(before)
  const afterLines = previewLines(after)
  const beforeCounts = countLines(beforeLines)
  const afterCounts = countLines(afterLines)
  const lines: Array<{ kind: 'removed' | 'context' | 'added'; text: string }> = []
  for (const line of beforeLines.slice(0, 2048)) {
    const remaining = afterCounts.get(line) ?? 0
    if (remaining > 0) {
      afterCounts.set(line, remaining - 1)
    } else {
      lines.push({ kind: 'removed', text: takeCharacters(line, 16_384) })
    }
  }
  for (const line of afterLines.slice(0, 2048)) {
    const remaining = beforeCounts.get(line) ?? 0
    if (remaining > 0) beforeCounts.set(line, remaining - 1)
    lines.push({
      kind: remaining > 0 ? 'context' : 'added',
      text: takeCharacters(line, 16_384)
    })
  }
  return { lines, truncated: beforeLines.length > 2048 || afterLines.length > 2048 }
}
