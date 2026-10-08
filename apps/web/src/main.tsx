import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { loadBundledTerminalFonts } from './terminal/terminal-fonts'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@xterm/xterm/css/xterm.css'
import './styles/fonts.css'
import './styles/foundation.css'
import './styles.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Renderer root element is missing')
}

void loadBundledTerminalFonts(document.fonts)
  .catch((error: unknown) => console.error('Could not load bundled terminal fonts', error))
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
