const TERMINAL_GLYPH_FALLBACKS = Object.freeze([
  '"Ternline Symbols"',
  '"JetBrainsMono Nerd Font Mono"',
  '"JetBrainsMono Nerd Font"',
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  '"Noto Color Emoji"',
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"'
])

/**
 * Keep the configured terminal face first, then let xterm's canvas renderer
 * resolve prompt icons from the bundled symbols font before platform fallbacks.
 */
export function withTerminalGlyphFallbacks(fontFamily: string): string {
  const families =
    fontFamily.match(/(?:[^,"']|"[^"]*"|'[^']*')+/gu)?.map((face) => face.trim()) ?? []
  const genericIndex = families.findIndex((face) =>
    /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/u.test(
      face
    )
  )
  families.splice(genericIndex < 0 ? families.length : genericIndex, 0, ...TERMINAL_GLYPH_FALLBACKS)
  return families.join(', ')
}

/** Load canvas fonts before xterm measures cells or caches missing glyphs in its atlas. */
export async function loadBundledTerminalFonts(fonts: Pick<FontFaceSet, 'load'>): Promise<void> {
  await Promise.all([
    fonts.load('400 13px "JetBrains Mono Variable"'),
    fonts.load('600 13px "JetBrains Mono Variable"'),
    fonts.load('400 13px "Ternline Symbols"', '\ue0b0\uf115\uf15b\uf31e\udb80\udc01')
  ])
}
