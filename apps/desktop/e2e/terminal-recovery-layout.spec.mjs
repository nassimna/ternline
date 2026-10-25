import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { _electron as electron, expect, test } from '@playwright/test'

import { closeElectronApplication } from './helpers/close-electron-application.mjs'

test.skip(process.platform === 'win32', 'The terminal fixture uses a POSIX shell.')

test('keeps recovery messages below terminal output and restarts the shell', async () => {
  test.setTimeout(90_000)
  const cache = join(homedir(), '.cache')
  await mkdir(cache, { recursive: true })
  const profile = await mkdtemp(join(cache, 'ternline-recovery-layout-e2e-'))
  const evidence = process.env.AGENT_WORKSPACE_EVIDENCE_DIR
  let application
  try {
    await writeFile(join(profile, '.zshrc'), '# Isolated terminal recovery shell.\n')
    await writeFile(
      join(profile, 'main.cjs'),
      `const { BrowserWindow } = require('electron')
BrowserWindow.prototype.show = function () {}
require(${JSON.stringify(resolve('out/main/index.js'))})
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
    const banner = pane.locator('.terminal-exit')
    const input = pane.locator('.xterm-helper-textarea')
    await expect(pane.locator('.terminal-statusbar')).toContainText('Connected')
    await page.getByRole('button', { name: 'Open terminal tools' }).click()
    await pane.getByRole('checkbox', { name: 'Screen reader mode' }).check()
    await pane.getByRole('button', { name: 'Close terminal tools' }).click()
    await input.focus()
    await page.keyboard.type(
      "for i in {1..80}; do printf 'Output line %s\\n' \"$i\"; done; printf 'LAST_OUTPUT_BEFORE_EXIT\\n'; exit 0"
    )
    await page.keyboard.press('Enter')
    await expect(banner).toContainText('Process exited with code 0')
    const exitMessage = await banner.locator('span').innerText()

    for (const width of [1280, 700]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(400, 400)
        window.setContentSize(width, 800)
      }, width)
      await page.setViewportSize({ width, height: 800 })
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
          for (const toolsOpen of [false, true]) {
            if (toolsOpen) await page.getByRole('button', { name: 'Open terminal tools' }).click()
            for (const message of [
              exitMessage,
              `Simulated long recovery error: ${'terminal_exited_'.repeat(25)}`
            ]) {
              await banner.locator('span').evaluate((element, text) => {
                element.textContent = text
              }, message)
              await expect
                .poll(async () => {
                  const host = await pane.locator('.terminal-host').boundingBox()
                  const screen = await pane.locator('.xterm-screen').boundingBox()
                  const notice = await banner.boundingBox()
                  return host.y + host.height <= notice.y && screen.y + screen.height <= notice.y
                })
                .toBe(true)
              const notice = await banner.boundingBox()
              const container = await pane.boundingBox()
              expect(notice.x).toBeGreaterThanOrEqual(container.x)
              expect(notice.x + notice.width).toBeLessThanOrEqual(container.x + container.width)
              const button = await banner
                .getByRole('button', { name: 'Restart terminal' })
                .boundingBox()
              expect(button.x).toBeGreaterThanOrEqual(notice.x)
              expect(button.x + button.width).toBeLessThanOrEqual(notice.x + notice.width)
              expect(
                await banner.evaluate((element) => element.scrollWidth <= element.clientWidth)
              ).toBe(true)
              await expect(pane.locator('.xterm-accessibility-tree')).toContainText(
                'LAST_OUTPUT_BEFORE_EXIT'
              )
              if (evidence && !toolsOpen && density === 'comfortable') {
                await mkdir(evidence, { recursive: true })
                const state = message === exitMessage ? 'exit' : 'simulated-long-error'
                await page.screenshot({
                  path: join(evidence, `terminal-recovery-${state}-${theme}-${width}.png`)
                })
              }
            }
            if (toolsOpen) await pane.getByRole('button', { name: 'Close terminal tools' }).click()
          }
        }
      }
    }
    await banner.locator('span').evaluate((element, text) => {
      element.textContent = text
    }, exitMessage)
    await banner.getByRole('button', { name: 'Restart terminal' }).click()
    await expect(banner).toHaveCount(0)
    await expect(pane.locator('.terminal-statusbar')).toContainText('Connected')
    await page.getByRole('button', { name: 'Open terminal tools' }).click()
    await pane.getByRole('checkbox', { name: 'Screen reader mode' }).check()
    await pane.getByRole('button', { name: 'Close terminal tools' }).click()
    await input.focus()
    await page.keyboard.type("printf 'RESTART_LAYOUT_OK\\n'")
    await page.keyboard.press('Enter')
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('RESTART_LAYOUT_OK')
  } finally {
    try {
      await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 3 })
    }
  }
})
