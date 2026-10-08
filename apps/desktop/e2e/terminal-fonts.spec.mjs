import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { _electron as electron, expect, test } from '@playwright/test'

import { closeElectronApplication } from './helpers/close-electron-application.mjs'

test('loads bundled text and Nerd Font glyphs before rendering terminal output', async () => {
  test.setTimeout(60_000)
  const profile = await mkdtemp(join(tmpdir(), 'ternline-fonts-e2e-'))
  const evidence = process.env.AGENT_WORKSPACE_EVIDENCE_DIR
  let application
  let failure
  try {
    await writeFile(join(profile, '.zshrc'), '# Disposable terminal font verification shell.\n')
    const environment = { ...process.env, ZDOTDIR: profile }
    delete environment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
      env: environment
    })
    const page = await application.firstWindow()
    await expect(page.locator('.terminal-pane')).toHaveAttribute('data-process-id', /^\d+$/)
    const glyphs = ['\ue0b0', '\uf115', '\uf15b', '\uf31e', '\udb80\udc01']
    const fonts = await page.evaluate((glyphs) => {
      const canvas = globalThis.document.createElement('canvas')
      canvas.width = 80
      canvas.height = 80
      const context = canvas.getContext('2d')
      const render = (text, font) => {
        context.clearRect(0, 0, 80, 80)
        context.font = font
        context.fillText(text, 8, 55)
        return canvas.toDataURL()
      }
      const loaded = [...globalThis.document.fonts].filter((font) => font.status === 'loaded')
      return {
        families: loaded.map((font) => font.family),
        distinct: glyphs.map(
          (glyph) =>
            render(glyph, '32px "Ternline Symbols", monospace') !==
              render('\udbff\udffd', '32px "Ternline Symbols", monospace') &&
            render(glyph, '32px "Ternline Symbols", monospace') !== render(glyph, '32px monospace')
        )
      }
    }, glyphs)
    expect(fonts.families).toContain('Ternline Symbols')
    expect(fonts.families).toContain('JetBrains Mono Variable')
    expect(fonts.distinct).toEqual(glyphs.map(() => true))

    await page.evaluate(async (glyphs) => {
      globalThis.__fontTestOutput = ''
      globalThis.desktopBridge.onTerminalEvent((event) => {
        if (event.event === 'terminal.output') {
          globalThis.__fontTestOutput += globalThis.atob(event.data.chunk.data)
        }
      })
      const { snapshot } = await globalThis.desktopBridge.listWorkspaces()
      const workspace = snapshot.workspaces.find(({ id }) => id === snapshot.selectedWorkspaceId)
      const terminalId = workspace.tabs[0].content.runtimeSessionId
      await globalThis.desktopBridge.sendTerminalInput(
        terminalId,
        `printf '\\n${glyphs.join('  ')}  Nerd Font glyphs\\n${glyphs[1]} Desktop  ${glyphs[2]} README.md\\n'\r`
      )
    }, glyphs)
    await expect
      .poll(() => page.evaluate(() => globalThis.__fontTestOutput))
      .toContain('Nerd Font glyphs')
    for (const width of [1280, 800]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, 700)
      }, width)
      for (const theme of ['dark', 'light']) {
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
        await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
        await settings
          .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
          .click()
        await page.keyboard.press('Escape')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        if (evidence) {
          await mkdir(evidence, { recursive: true })
          await page.screenshot({ path: join(evidence, `terminal-fonts-${theme}-${width}.png`) })
        }
      }
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await application?.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      })
      await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 }).catch((error) => {
        if (!failure) throw error
      })
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  }
})
