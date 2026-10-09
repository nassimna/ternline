import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { _electron as electron, expect, test } from '@playwright/test'

import { closeElectronApplication } from './helpers/close-electron-application.mjs'

test.skip(process.platform === 'win32', 'The terminal fixture uses a POSIX shell.')

test('reads and copies history during continuous output, resumes following, and preserves full-screen scrolling', async () => {
  test.setTimeout(90_000)
  const cache = join(homedir(), '.cache')
  await mkdir(cache, { recursive: true })
  const profile = await mkdtemp(join(cache, 'ternline-scrolling-e2e-'))
  const evidence = process.env.AGENT_WORKSPACE_EVIDENCE_DIR
  let application
  try {
    await writeFile(join(profile, '.zshrc'), '# Isolated terminal scrolling shell.\n')
    await writeFile(
      join(profile, 'main.cjs'),
      `const { BrowserWindow } = require('electron')
BrowserWindow.prototype.show = function () {}
require(${JSON.stringify(resolve('out/main/index.js'))})
`
    )
    await writeFile(
      join(profile, 'stream.cjs'),
      `for (let i = 1; i <= 150; i++) process.stdout.write('Previous response line ' + i + '\\r\\n')
process.stdin.setRawMode(true)
process.stdin.resume()
let i = 0
let fullScreen = false
const timer = setInterval(() => process.stdout.write('New response continues ' + ++i + '\\r\\n'), 10)
process.stdin.on('data', data => {
  if (data.toString().includes('q')) {
    if (fullScreen) {
      process.stdout.write('\\x1b[?1000l\\x1b[?1006l\\x1b[?1049l')
      process.exit(0)
    }
    clearInterval(timer)
    fullScreen = true
    process.stdout.write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006h\\x1b[HFull-screen application')
  } else if (fullScreen && /\\x1b\\[<6[45];/.test(data.toString())) {
    process.stdout.write('\\x1b[2;1HMOUSE_WHEEL_OK')
  }
})
`
    )
    const environment = { ...process.env, ZDOTDIR: profile }
    delete environment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      args: [join(profile, 'main.cjs'), `--user-data-dir=${profile}`, '--mute-audio'],
      env: environment
    })
    const page = await application.firstWindow()
    const pane = page.locator('.terminal-pane')
    await expect(pane.locator('.terminal-statusbar')).toContainText('Connected')
    await page.getByRole('button', { name: 'Open terminal tools' }).click()
    await pane.getByRole('checkbox', { name: 'Screen reader mode' }).check()
    await pane.getByRole('button', { name: 'Close terminal tools' }).click()
    const rows = pane.locator('.xterm-accessibility-tree > div')
    const input = pane.locator('.xterm-helper-textarea')
    await page.evaluate(() => {
      globalThis.__scrollingOutput = ''
      globalThis.desktopBridge.onTerminalEvent((event) => {
        if (event.event === 'terminal.output') {
          globalThis.__scrollingOutput += globalThis.atob(event.data.chunk.data)
        }
      })
      globalThis.__copiedSelection = ''
      globalThis.navigator.clipboard.writeText = async (value) => {
        globalThis.__copiedSelection = value
      }
    })
    await input.focus()
    await page.keyboard.type(`${process.execPath} ${join(profile, 'stream.cjs')}`)
    await page.keyboard.press('Enter')
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('New response continues')
    const screen = pane.locator('.xterm-screen')
    const box = await screen.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -4000)
    await expect(pane.getByRole('button', { name: 'New output ↓' })).toBeVisible()
    await expect(rows.filter({ hasText: 'Previous response' }).first()).toBeAttached()
    const reading = await rows.allTextContents()
    const outputLength = await page.evaluate(() => globalThis.__scrollingOutput.length)
    await expect
      .poll(() => page.evaluate(() => globalThis.__scrollingOutput.length))
      .toBeGreaterThan(outputLength + 1000)
    expect(await rows.allTextContents()).toEqual(reading)

    const rowIndex = await rows.evaluateAll((elements) =>
      elements.findIndex((element) => element.textContent.includes('Previous response'))
    )
    const cellHeight = box.height / (await rows.count())
    await page.mouse.dblclick(box.x + 18, box.y + (rowIndex + 0.5) * cellHeight)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+c')
    await expect.poll(() => page.evaluate(() => globalThis.__copiedSelection)).toContain('Previous')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    for (const width of [1280, 900]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, 800)
      }, width)
      for (const theme of ['dark', 'light']) {
        for (const density of ['comfortable', 'compact']) {
          await page.getByRole('button', { name: 'Open settings', exact: true }).click()
          const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
          await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
          await settings
            .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
            .click()
          await settings.getByRole('combobox', { name: 'Density', exact: true }).click()
          await page
            .getByRole('option', {
              name: density === 'comfortable' ? 'Comfortable' : 'Compact',
              exact: true
            })
            .click()
          await page.keyboard.press('Escape')
          await expect(pane.getByRole('button', { name: 'New output ↓' })).toBeVisible()
          if (evidence) {
            await mkdir(evidence, { recursive: true })
            await page.screenshot({
              path: join(evidence, `terminal-scrolling-${theme}-${density}-${width}.png`)
            })
          }
        }
      }
    }
    await pane.getByRole('button', { name: 'New output ↓' }).click()
    await expect(pane.getByRole('button', { name: 'New output ↓' })).toHaveCount(0)
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('New response continues')
    const following = await rows.last().getAttribute('aria-posinset')
    await expect.poll(() => rows.last().getAttribute('aria-posinset')).not.toBe(following)
    await page.keyboard.press('q')
    await expect(rows.first()).toContainText('Full-screen application')
    const selectionBox = await screen.boundingBox()
    await page.keyboard.down(process.platform === 'darwin' ? 'Alt' : 'Shift')
    await page.mouse.dblclick(selectionBox.x + 18, selectionBox.y + 7)
    await page.keyboard.up(process.platform === 'darwin' ? 'Alt' : 'Shift')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+c')
    await expect.poll(() => page.evaluate(() => globalThis.__copiedSelection)).toContain('Full')
    const fullScreenBox = await screen.boundingBox()
    await page.mouse.move(fullScreenBox.x + 100, fullScreenBox.y + 100)
    await page.mouse.wheel(0, -200)
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('MOUSE_WHEEL_OK')
    await expect(pane.getByRole('button', { name: 'New output ↓' })).toHaveCount(0)
    await page.keyboard.press('q')
  } finally {
    try {
      await application?.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      })
      await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  }
})
