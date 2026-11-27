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
  const lines = value.includes('\r\n') ? value.split(/\r?\n/u) : value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function inlineNodes(value: string): SafeMarkdownNode[] {
  const bounded = takeCharacters(value, 16_384)
  if (!bounded.includes('<') && !bounded.includes('>')) {
    const a = bounded.indexOf('[')
    const b = bounded.indexOf('](', a + 1)
    if (a >= 0 && b > a) {
      let c = b + 2
      let depth = 0
      for (; c < bounded.length; c++) {
        if (bounded[c] === '(') depth++
        if (bounded[c] === ')') {
          if (depth === 0) break
          depth--
        }
      }
      if (c === bounded.length) return [{ kind: 'text', text: bounded }]

      let labelStart = a
      let bracketDepth = 1
      for (let index = a + 1; index < b; index++) {
        const character = bounded[index]
        if (character === '\\') {
          index++
        } else if (character === '[') {
          if (bracketDepth === 0) labelStart = index
          bracketDepth++
        } else if (character === ']' && bracketDepth > 0) {
          bracketDepth--
        }
      }

      const href = bounded.slice(b + 2, c)
      const label = bounded.slice(labelStart + 1, b)
      if (
        !(href.startsWith('http://') || href.startsWith('https://')) ||
        href.length > 2048 ||
        label.length > 2048
      ) {
        return [{ kind: 'text', text: bounded }]
      }
      try {
        const parsed = new URL(href)
        if (!parsed.username && !parsed.password) {
          const nodes: SafeMarkdownNode[] = [{ kind: 'link', label, href }]
          if (labelStart > 0) nodes.unshift({ kind: 'text', text: bounded.slice(0, labelStart) })
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
  const lines = previewLines(source.replace(/^\uFEFF/u, ''))
  let remainingNodes = 4096
  for (let index = 0; index < lines.length && remainingNodes > 0; index++) {
    const line = lines[index]!
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const rows: string[] = []
      while (++index < lines.length && !/^```[ \t]*$/u.test(lines[index]!)) {
        rows.push(takeCharacters(lines[index]!, 16_384))
      }
      nodes.push({
        kind: 'codeBlock',
        language: language ? takeCharacters(language, 32) : null,
        text: takeCharacters(rows.join('\n'), 65_536)
      })
      remainingNodes--
      continue
    }
    if (!line.trim()) continue

    const hashes = /^#{1,6} /u.exec(line)?.[0].length
    const isList = line.startsWith('- ')
    const children = inlineNodes(line.slice(hashes ?? (isList ? 2 : 0)))
    const blockNodes = children.length + (isList ? 2 : 1)
    if (blockNodes > remainingNodes) break
    remainingNodes -= blockNodes

    if (hashes) {
      nodes.push({ kind: 'heading', level: hashes - 1, children })
    } else if (isList) {
      nodes.push({
        kind: 'list',
        ordered: false,
        items: [{ kind: 'listItem', children }]
      })
    } else {
      nodes.push({ kind: 'paragraph', children })
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
  const rowLimit = 2048
  const lineTextLimit = 16_384
  const beforeLines = previewLines(before)
  const afterLines = previewLines(after)
  const afterPreview = afterLines.slice(0, rowLimit)
  let truncated = beforeLines.length > rowLimit || afterLines.length > rowLimit
  if (
    truncated &&
    beforeLines.length >= rowLimit &&
    afterPreview.length === rowLimit &&
    afterPreview.every((line, index) => line === beforeLines[index])
  ) {
    return {
      lines: afterPreview.map((line) => ({
        kind: 'context' as const,
        text: takeCharacters(line, lineTextLimit)
      })),
      truncated: true
    }
  }

  const beforeCounts = countLines(beforeLines)
  const afterCounts = countLines(afterLines)
  const lines: Array<{ kind: 'removed' | 'context' | 'added'; text: string }> = []
  for (const line of beforeLines.slice(0, rowLimit)) {
    const remaining = afterCounts.get(line) ?? 0
    if (remaining > 0) {
      afterCounts.set(line, remaining - 1)
    } else {
      truncated ||= line.length > lineTextLimit
      lines.push({ kind: 'removed', text: takeCharacters(line, lineTextLimit) })
    }
  }
  for (const line of afterPreview) {
    const remaining = beforeCounts.get(line) ?? 0
    if (remaining > 0) beforeCounts.set(line, remaining - 1)
    truncated ||= line.length > lineTextLimit
    lines.push({
      kind: remaining > 0 ? 'context' : 'added',
      text: takeCharacters(line, lineTextLimit)
    })
  }
  return { lines, truncated }
}
