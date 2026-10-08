import { describe, expect, it, vi } from 'vitest'

import { loadBundledTerminalFonts, withTerminalGlyphFallbacks } from './terminal-fonts'

describe('withTerminalGlyphFallbacks', () => {
  it('preserves the configured primary face and adds Nerd Font and emoji fallbacks', () => {
    expect(withTerminalGlyphFallbacks('Iosevka')).toBe(
      'Iosevka, "Ternline Symbols", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"'
    )
  })

  it('preserves a configured CSS font stack', () => {
    expect(withTerminalGlyphFallbacks('"Berkeley Mono", monospace')).toMatch(
      /^"Berkeley Mono", "Ternline Symbols", .*monospace$/u
    )
  })

  it('keeps quoted family names intact and places glyph faces before generic fallbacks', () => {
    expect(withTerminalGlyphFallbacks('"Custom, Mono", ui-monospace, monospace')).toMatch(
      /^"Custom, Mono", "Ternline Symbols", .*ui-monospace, monospace$/u
    )
  })
})

describe('loadBundledTerminalFonts', () => {
  it('waits for the text and symbols faces before allowing canvas rendering', async () => {
    let finishSymbols!: (faces: FontFace[]) => void
    const load = vi.fn((font: string) =>
      font.includes('Ternline Symbols')
        ? new Promise<FontFace[]>((resolve) => {
            finishSymbols = resolve
          })
        : Promise.resolve([])
    )
    let ready = false
    const pending = loadBundledTerminalFonts({ load }).then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    expect(load.mock.calls.map(([font]) => font)).toEqual([
      '400 13px "JetBrains Mono Variable"',
      '600 13px "JetBrains Mono Variable"',
      '400 13px "Ternline Symbols"'
    ])
    finishSymbols([])
    await pending
    expect(ready).toBe(true)
  })

  it('reports an asset failure so startup can recover rather than hang', async () => {
    const failure = new Error('font asset unavailable')
    await expect(
      loadBundledTerminalFonts({ load: vi.fn().mockRejectedValue(failure) })
    ).rejects.toBe(failure)
  })
})
