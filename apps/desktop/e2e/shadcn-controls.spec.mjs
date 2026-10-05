import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { _electron as electron, expect, test } from '@playwright/test'

import { closeElectronApplication } from './helpers/close-electron-application.mjs'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(desktopDirectory, '../..')
const evidenceDirectory = join(tmpdir(), 'ternline-shadcn-controls-evidence')

test.beforeAll(async () => {
  test.setTimeout(120_000)
  execFileSync('pnpm', ['build:node'], { cwd: repositoryDirectory, stdio: 'inherit' })
  execFileSync('pnpm', ['--filter', '@agent-workspace/desktop', 'build'], {
    cwd: repositoryDirectory,
    stdio: 'inherit'
  })
  await mkdir(evidenceDirectory, { recursive: true })
})

test('shared surfaces, palette, and alpha settings work through the real desktop bridge', async () => {
  test.setTimeout(90_000)
  const profileDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'ternline-shadcn-controls-profile-'))
  )
  await writeFile(join(profileDirectory, '.zshrc'), '# Disposable UI verification profile.\n')
  let application
  let failure
  try {
    const environment = { ...process.env, ZDOTDIR: profileDirectory }
    delete environment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      args: [join(desktopDirectory, 'out/main/index.js'), `--user-data-dir=${profileDirectory}`],
      cwd: desktopDirectory,
      env: environment,
      timeout: 20_000
    })
    const page = await application.firstWindow({ timeout: 20_000 })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const { snapshot } = await globalThis.desktopBridge.listWorkspaces()
      const workspaceId = snapshot.selectedWorkspaceId
      for (const payload of [
        { kind: 'agentStatus', value: { status: 'running', label: 'UI verification' } },
        { kind: 'progress', value: { mode: 'determinate', value: 42, label: 'UI verification' } }
      ]) {
        await globalThis.desktopBridge.replaceWorkspaceCardSlotV2({
          workspaceId,
          kind: payload.kind,
          expectedRevision: 0,
          payload
        })
      }
    })
    const card = page.locator('.workspace-card').first()
    await expect(card).toHaveAttribute('data-slot', 'card')
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    await expect(card.locator('.workspace-activity')).toHaveAttribute('data-slot', 'badge')

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 960, height: 640 }
    ]) {
      await application.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
      }, viewport)
      await page.setViewportSize(viewport)
      await expect
        .poll(() => page.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]))
        .toEqual([viewport.width, viewport.height])
      await page.getByRole('button', { name: 'Open update settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      const channel = settings.getByRole('combobox', { name: 'Update channel' })
      await expect(channel).toHaveText('Alpha')
      await channel.click()
      await expect(page.getByRole('option')).toHaveCount(1)
      await expect(page.getByRole('option', { name: 'Alpha' })).toBeVisible()
      await page.screenshot({ path: join(evidenceDirectory, `updates-${viewport.width}.png`) })
      await page.keyboard.press('Escape')
      await expect(channel).toBeFocused()
      await expect(settings).toBeVisible()
      const automatic = settings.getByRole('checkbox', {
        name: 'Automatically check and download updates'
      })
      expect(
        await automatic.evaluate((element) =>
          Number.parseFloat(globalThis.getComputedStyle(element).borderTopWidth)
        )
      ).toBeGreaterThanOrEqual(1)
      const nextAutomatic = !(await automatic.isChecked())
      await automatic.click()
      await expect
        .poll(() =>
          page.evaluate(
            async () => (await globalThis.desktopBridge.getConfiguration()).config.updates.automatic
          )
        )
        .toBe(nextAutomatic)
      await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
      const density = settings.getByRole('combobox', { name: 'Density' })
      const fontInput = settings.locator('.configuration-font-control input')
      const appearance = (element) => {
        const style = globalThis.getComputedStyle(element)
        return [
          style.height,
          style.borderRadius,
          style.borderTopWidth,
          style.backgroundColor,
          style.fontFamily,
          style.fontSize
        ]
      }
      expect(await fontInput.evaluate(appearance)).toEqual(await density.evaluate(appearance))
      await density.click()
      await page.getByRole('option', { name: 'Compact', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await globalThis.desktopBridge.getConfiguration()).config.appearance.density
          )
        )
        .toBe('compact')
      await expect(density).toBeFocused()
      await page.screenshot({ path: join(evidenceDirectory, `appearance-${viewport.width}.png`) })
      if (viewport.width === 1280) {
        await settings.getByRole('button', { name: 'Dark', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      }
      await settings.getByRole('button', { name: 'Choose interface font' }).click()
      await page.getByRole('menuitem', { name: 'JetBrains Mono Variable', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await globalThis.desktopBridge.getConfiguration()).config.appearance.fontFamily
          )
        )
        .toBe('JetBrains Mono Variable')
      await settings.getByRole('button', { name: 'Advanced', exact: true }).click()
      const logLevel = settings.getByRole('combobox', { name: 'Log level' })
      await logLevel.click()
      await page.getByRole('option', { name: 'Debug', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(
            async () => (await globalThis.desktopBridge.getConfiguration()).config.logging.level
          )
        )
        .toBe('debug')
      await page.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)
      await page.screenshot({ path: join(evidenceDirectory, `workspace-${viewport.width}.png`) })

      await page.getByRole('button', { name: 'Open terminal tools', exact: true }).click()
      const terminalTools = page.locator('.terminal-toolbar')
      await expect(terminalTools.getByRole('textbox', { name: 'Find in terminal' })).toBeVisible()
      const fieldFits = await terminalTools.getByRole('textbox').evaluate((element) => {
        const field = element.getBoundingClientRect()
        const toolbar = element.closest('.terminal-toolbar').getBoundingClientRect()
        return field.top >= toolbar.top && field.bottom <= toolbar.bottom
      })
      expect(fieldFits).toBe(true)
      await page.screenshot({
        path: join(evidenceDirectory, `terminal-tools-${viewport.width}.png`)
      })
      await page.getByRole('button', { name: 'Close terminal tools', exact: true }).first().click()

      await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
      const search = page.getByRole('combobox', { name: 'Search commands' })
      await expect(search).toHaveAttribute('aria-activedescendant', /.+/)
      await search.fill('settings')
      await expect(page.getByRole('option', { selected: true })).toContainText('Settings')
      await page.screenshot({ path: join(evidenceDirectory, `palette-${viewport.width}.png`) })
      await search.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    }

    // Seed local notification data only in this disposable profile.
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const notificationSettings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await notificationSettings.getByRole('button', { name: 'Notifications', exact: true }).click()
    const systemNotifications = notificationSettings.getByRole('checkbox', {
      name: 'Enable system notifications'
    })
    if (await systemNotifications.isChecked()) await systemNotifications.click()
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await globalThis.desktopBridge.getConfiguration()).config.notifications.systemEnabled
        )
      )
      .toBe(false)
    await page.keyboard.press('Escape')
    execFileSync(
      'node',
      [
        join(repositoryDirectory, 'apps/cli/dist/bin.mjs'),
        '--session-file',
        join(profileDirectory, 'runtime/node-cli-session.json'),
        'notify',
        '--title',
        'Design system verification',
        '--body',
        'Shared notification surface',
        '--level',
        'info'
      ],
      { cwd: repositoryDirectory, stdio: 'pipe' }
    )
    await page.getByRole('button', { name: /^Open notifications/ }).click()
    const notificationCard = page
      .locator('.notification-item')
      .filter({ hasText: 'Design system verification' })
    await expect(notificationCard).toHaveAttribute('data-slot', 'card')
    await expect(notificationCard.locator('.notification-severity')).toHaveAttribute(
      'data-slot',
      'badge'
    )
    await page.screenshot({ path: join(evidenceDirectory, 'notifications-960.png') })
    await page.keyboard.press('Escape')

    const workspace = page.locator('.workspace-row').first()
    await workspace.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename workspace…' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename workspace…' })
    await rename.getByRole('textbox').fill('Shadcn verification')
    await rename.getByRole('button', { name: 'Continue' }).click()
    await expect(workspace).toContainText('Shadcn verification')
    await workspace.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Close workspace', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Confirm action' })).toBeVisible()
    await page.screenshot({ path: join(evidenceDirectory, 'confirmation.png') })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(workspace).toContainText('Shadcn verification')
    expect(pageErrors).toEqual([])
  } catch (cause) {
    failure = cause
  }
  const cleanupErrors = []
  try {
    await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
  } catch (cause) {
    cleanupErrors.push(cause)
  }
  try {
    await rm(profileDirectory, { recursive: true, force: true })
  } catch (cause) {
    cleanupErrors.push(cause)
  }
  if (failure) {
    if (cleanupErrors.length) {
      throw new AggregateError([failure, ...cleanupErrors], failure.message, { cause: failure })
    }
    throw failure
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Disposable desktop test cleanup failed.')
  }
})
