import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron, expect, test } from '@playwright/test'
import axe from 'axe-core'
import electronExecutable from 'electron'

import { closeElectronApplication } from './helpers/close-electron-application.mjs'
import { createPackagedElectronHarness } from './helpers/packaged-electron-harness.mjs'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(desktopDirectory, '../..')
const dialogHarnessEntry = join(desktopDirectory, 'e2e/helpers/dialog-harness-main.cjs')
const evidenceDirectory =
  process.env.AGENT_WORKSPACE_EVIDENCE_DIR ??
  join(repositoryDirectory, 'dogfood-output/ssh-workspaces')

test.skip(process.platform === 'win32', 'The isolated OpenSSH fixture requires a POSIX shell.')

async function createSshHarness(profileDirectory) {
  if (process.platform === 'linux') return createPackagedElectronHarness(profileDirectory)
  const runtimeDirectory = join(profileDirectory, 'runtime')
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
  return { executablePath: electronExecutable, runtimeDirectory, electronEnvironment: {} }
}

const sshFixture = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *invalid-host*) printf 'Permission denied (publickey).\\n' >&2; exit 255 ;;
  esac
  last="$arg"
done
if [ "$last" = true ]; then exit 0; fi
printf "SSH_ARGS:%s\\n" "$*"
sleep 120
`

async function auditDialog(page) {
  await page.evaluate(axe.source)
  const violations = await page.evaluate(async () => {
    const dialog = globalThis.document.querySelector('[role="dialog"]')
    if (!dialog) throw new Error('The expected dialog is missing')
    const results = await globalThis.axe.run(dialog, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
    })
    return results.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
    }))
  })
  expect.soft(violations).toEqual([])
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  execFileSync('pnpm', ['--filter', '@agent-workspace/desktop', 'build'], {
    cwd: repositoryDirectory,
    stdio: 'pipe'
  })
  await mkdir(evidenceDirectory, { recursive: true })
})

test('keeps output responsive and manages a saved SSH workspace', async () => {
  test.setTimeout(120_000)
  const cacheDirectory = join(homedir(), '.cache')
  await mkdir(cacheDirectory, { recursive: true })
  const profileDirectory = await mkdtemp(join(cacheDirectory, 'agent-workspace-ssh-e2e-'))
  const binDirectory = join(profileDirectory, 'bin')
  const sshExecutable = join(binDirectory, 'ssh')
  let harness
  let application
  const launch = async () => {
    const electronEnvironment = { ...process.env }
    delete electronEnvironment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      args: [dialogHarnessEntry, `--user-data-dir=${profileDirectory}`, '--disable-gpu'],
      cwd: desktopDirectory,
      executablePath: harness.executablePath,
      env: {
        ...electronEnvironment,
        ...harness.electronEnvironment,
        AGENT_WORKSPACE_E2E_DIALOG_RESPONSES: '{}',
        AGENT_WORKSPACE_E2E_USER_DATA_DIR: profileDirectory,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        HOME: profileDirectory,
        PATH: `${binDirectory}:${process.env.PATH}`,
        TMPDIR: harness.runtimeDirectory,
        XDG_RUNTIME_DIR: harness.runtimeDirectory,
        ZDOTDIR: profileDirectory
      }
    })
    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800)
    })
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(page.locator('.terminal-pane')).toHaveCount(1)
    return page
  }

  try {
    await mkdir(binDirectory)
    await writeFile(sshExecutable, sshFixture)
    await chmod(sshExecutable, 0o700)
    harness = await createSshHarness(profileDirectory)
    let page = await launch()
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('seq 1 20000; printf "OUTPUT_COMPLETE\\n"')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText('OUTPUT_COMPLETE', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Split pane right' }).click()
    await expect(page.locator('.terminal-pane')).toHaveCount(2)
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 700)
    })
    await page.setViewportSize({ width: 900, height: 700 })
    await page.locator('.xterm-helper-textarea').last().focus()
    await page.keyboard.type('printf "AFTER_RESIZE\\n"')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => {
        const visible = await page.locator('.xterm-rows').last().innerText()
        return visible.split('AFTER_RESIZE').length - 1
      })
      .toBeGreaterThanOrEqual(2)
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800)
    })
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.getByRole('button', { name: 'Create SSH workspace' }).click()
    await auditDialog(page)
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Demo SSH')
    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('demo-host')
    await page.getByRole('textbox', { name: 'Username (optional)' }).fill('deploy')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-workspace-create.png') })
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'Connection successful.'
    )
    await page.getByRole('button', { name: 'Create and pin' }).click()
    await expect(page.locator('.workspace-section[data-section-kind="pinned"]')).toContainText(
      'Demo SSH'
    )
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    await expect(page.getByRole('button', { name: 'Unpin Demo SSH', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('button', { name: 'Pin Workspace 1' }).click()
    await expect(page.getByRole('button', { name: 'Unpin Workspace 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('button', { name: 'Unpin Workspace 1' }).click()
    await expect(page.getByRole('button', { name: 'Pin Workspace 1' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-workspace-desktop.png') })

    await closeElectronApplication(application)
    application = undefined
    page = await launch()
    await expect(page.locator('.workspace-section[data-section-kind="pinned"]')).toContainText(
      'Demo SSH'
    )
    await page.getByRole('button', { name: 'New SSH shell in Demo SSH' }).click()
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    await page.locator('.workspace-card').filter({ hasText: 'Demo SSH' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit SSH connection' }).click()
    await auditDialog(page)
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-workspace-edit.png') })
    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('edited-host')
    await page.getByRole('button', { name: 'Save connection' }).click()
    await expect(page.getByRole('button', { name: 'New SSH shell in Demo SSH' })).toBeVisible()
    await page.getByRole('button', { name: 'New SSH shell in Demo SSH' }).click()
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@edited-host')
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 700)
    })
    await page.setViewportSize({ width: 900, height: 700 })
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-workspace-narrow.png') })

    await page.evaluate(() => {
      globalThis.window.confirm = () => true
    })
    await page.getByRole('button', { name: 'Close Demo SSH' }).click()
    await expect(page.getByRole('button', { name: 'Create SSH workspace' })).toBeVisible()
    await page.getByRole('button', { name: 'Create SSH workspace' }).click()
    await auditDialog(page)
    await expect(
      page.getByRole('region', { name: 'Previously saved SSH connections' })
    ).toContainText('deploy@edited-host:22')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-workspace-saved.png') })
    await page.getByRole('button', { name: 'Use details' }).click()
    await expect(page.getByRole('textbox', { name: 'SSH host or alias' })).toHaveValue(
      'edited-host'
    )
    await page.getByRole('button', { name: 'Remove saved SSH details for edited-host' }).click()
    await expect(
      page.getByRole('region', { name: 'Previously saved SSH connections' })
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'Connection successful.'
    )
    await page.getByRole('button', { name: 'Create and pin' }).click()
    await expect(page.locator('.workspace-section[data-section-kind="pinned"]')).toContainText(
      'edited-host'
    )
  } finally {
    await closeElectronApplication(application).catch(() => undefined)
    await rm(profileDirectory, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('tests SSH connections, restores remote terminals and uses saved details for new tabs', async () => {
  test.setTimeout(120_000)
  const profileDirectory = await mkdtemp(join(homedir(), '.cache/aw-ssh-tab-'))
  const binDirectory = join(profileDirectory, 'bin')
  let application
  try {
    await mkdir(binDirectory)
    const sshExecutable = join(binDirectory, 'ssh')
    await writeFile(sshExecutable, sshFixture)
    await chmod(sshExecutable, 0o700)
    const harness = await createSshHarness(profileDirectory)
    const launch = async () => {
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      application = await electron.launch({
        args: [dialogHarnessEntry, `--user-data-dir=${profileDirectory}`, '--disable-gpu'],
        cwd: desktopDirectory,
        executablePath: harness.executablePath,
        env: {
          ...environment,
          ...harness.electronEnvironment,
          AGENT_WORKSPACE_E2E_DIALOG_RESPONSES: '{}',
          AGENT_WORKSPACE_E2E_USER_DATA_DIR: profileDirectory,
          HOME: profileDirectory,
          PATH: `${binDirectory}:${process.env.PATH}`,
          TMPDIR: harness.runtimeDirectory,
          XDG_RUNTIME_DIR: harness.runtimeDirectory,
          ZDOTDIR: profileDirectory
        }
      })
      const page = await application.firstWindow()
      if (process.platform === 'darwin') await application.evaluate(({ app }) => app.hide())
      expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(
        profileDirectory
      )
      await expect(page.locator('.terminal-pane')).toHaveAttribute('data-process-id', /^\d+$/)
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800)
      })
      await page.setViewportSize({ width: 1200, height: 800 })
      return page
    }
    let page = await launch()
    await page.getByRole('button', { name: 'Create SSH workspace' }).click()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Demo SSH')
    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('invalid-host')
    await expect(page.getByRole('button', { name: 'Create and pin' })).toBeDisabled()
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Permission denied')
    await expect(page.getByRole('button', { name: 'Create and pin' })).toBeDisabled()
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-connection-failed.png') })
    const countBefore = await page.evaluate(
      async () =>
        (await globalThis.window.desktopBridge.listWorkspaces()).snapshot.workspaces.length
    )
    await expect(
      page.evaluate(() =>
        globalThis.window.desktopBridge.createWorkspace({
          name: 'Rejected SSH',
          workingDirectory: '/',
          ssh: { host: 'invalid-host', user: '', port: 22 },
          initialTerminal: { cwd: '/', rows: 24, cols: 80 }
        })
      )
    ).rejects.toThrow('SSH connection failed')
    expect(
      await page.evaluate(
        async () =>
          (await globalThis.window.desktopBridge.listWorkspaces()).snapshot.workspaces.length
      )
    ).toBe(countBefore)

    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('demo-host')
    await page.getByRole('textbox', { name: 'Username (optional)' }).fill('deploy')
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'Connection successful.'
    )
    for (const theme of ['dark', 'light']) {
      for (const density of ['comfortable', 'compact']) {
        for (const width of [1200, 900]) {
          await application.evaluate(({ BrowserWindow }, width) => {
            BrowserWindow.getAllWindows()[0]?.setContentSize(width, 800)
          }, width)
          await page.setViewportSize({ width, height: 800 })
          await page.evaluate(
            ({ theme, density }) => {
              globalThis.document.documentElement.dataset.theme = theme
              globalThis.document.documentElement.dataset.density = density
            },
            { theme, density }
          )
          await auditDialog(page)
          await page.screenshot({
            path: join(evidenceDirectory, `ssh-tested-${theme}-${density}-${width}.png`)
          })
        }
      }
    }
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800)
    })
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.getByRole('button', { name: 'Create and pin' }).click()
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
    application = undefined
    page = await launch()
    await expect(page.locator('.workspace-section[data-section-kind="pinned"]')).toContainText(
      'Demo SSH'
    )
    await page.locator('.workspace-card').filter({ hasText: 'Demo SSH' }).click()
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    const legacyWorkspaceId = await page.evaluate(async () => {
      const { snapshot } = await globalThis.window.desktopBridge.listWorkspaces()
      const sshWorkspace = snapshot.workspaces.find(({ name }) => name === 'Demo SSH')
      await globalThis.window.desktopBridge.updateWorkspace({
        workspaceId: sshWorkspace.id,
        ssh: { value: null }
      })
      return sshWorkspace.id
    })
    await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
    application = undefined
    page = await launch()
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    await expect
      .poll(async () => {
        const { snapshot } = await page.evaluate(() =>
          globalThis.window.desktopBridge.listWorkspaces()
        )
        return snapshot.workspaces.find(({ id }) => id === legacyWorkspaceId)?.ssh?.host
      })
      .toBe('demo-host')
    await page.getByRole('button', { name: 'Add tab' }).click()
    await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@demo-host')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-add-tab-desktop.png') })
    await page.locator('.workspace-card').filter({ hasText: 'Demo SSH' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit SSH connection' }).click()
    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('edited-host')
    await page.getByRole('button', { name: 'Save connection' }).click()
    await page.getByRole('button', { name: 'Add tab' }).click()
    await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.xterm-rows').last()).toContainText('SSH_ARGS:deploy@edited-host')
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 700)
    })
    await page.setViewportSize({ width: 900, height: 700 })
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-add-tab-narrow.png') })
  } finally {
    await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 }).catch(
      () => undefined
    )
    await rm(profileDirectory, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('reconnects an exited SSH terminal through the visible recovery button', async () => {
  test.setTimeout(120_000)
  const profileDirectory = await mkdtemp(join(homedir(), '.cache/ternline-ssh-recovery-'))
  let application
  try {
    const binDirectory = join(profileDirectory, 'bin')
    await mkdir(binDirectory)
    await writeFile(join(profileDirectory, '.zshrc'), '')
    await writeFile(join(profileDirectory, '.zshenv'), '')
    await writeFile(
      join(binDirectory, 'ssh'),
      `#!/bin/sh
for arg in "$@"; do last="$arg"; done
if [ "$last" = true ]; then
  sleep 1
  if [ -f "$TERNLINE_SSH_FIXTURE/offline" ]; then
    printf 'Host unreachable.\\n' >&2
    exit 255
  fi
  exit 0
fi
printf 'SSH_READY\\n'
while IFS= read -r line; do
  if [ "$line" = drop ]; then
    printf 'Read from remote host: Operation timed out\\n' >&2
    exit 255
  fi
  printf 'SSH_REPLY:%s\\n' "$line"
done
`
    )
    await chmod(join(binDirectory, 'ssh'), 0o700)
    const entry = join(profileDirectory, 'main.cjs')
    await writeFile(
      entry,
      `const {BrowserWindow,dialog}=require('electron');
BrowserWindow.prototype.show=function(){};
dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
require(${JSON.stringify(join(desktopDirectory, 'out/main/index.js'))});`
    )
    const harness = await createSshHarness(profileDirectory)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      executablePath: harness.executablePath,
      args: [entry, `--user-data-dir=${profileDirectory}`, '--mute-audio'],
      env: {
        ...environment,
        ...harness.electronEnvironment,
        PATH: `${binDirectory}:${process.env.PATH}`,
        ZDOTDIR: profileDirectory,
        TERNLINE_SSH_FIXTURE: profileDirectory,
        TMPDIR: harness.runtimeDirectory,
        XDG_RUNTIME_DIR: harness.runtimeDirectory
      }
    })
    const page = await application.firstWindow()
    page.setDefaultTimeout(15_000)
    await page.getByRole('button', { name: 'Create SSH workspace' }).click()
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('SSH recovery fixture')
    await page.getByRole('textbox', { name: 'SSH host or alias' }).fill('fixture-host')
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await expect(page.getByText('Connection successful.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Create and pin' }).click()
    const pane = page.locator('.terminal-pane').last()
    await page.getByRole('button', { name: 'Open terminal tools', exact: true }).click()
    await pane.getByRole('checkbox', { name: 'Screen reader mode' }).check()
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('SSH_READY')
    const oldTerminalId = await pane.getAttribute('data-terminal-id')
    await pane.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('drop')
    await page.keyboard.press('Enter')
    await expect(pane.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
    await page.keyboard.type('after-drop')
    await expect(pane.locator('.terminal-exit')).toContainText('SSH connection lost.')
    await expect(pane.locator('.terminal-exit')).not.toContainText('terminal:send')
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('SSH_READY')

    for (const theme of ['dark', 'light']) {
      for (const density of ['comfortable', 'compact']) {
        for (const width of [1200, 900]) {
          await application.evaluate(({ BrowserWindow }, width) => {
            BrowserWindow.getAllWindows()[0].setContentSize(width, 800)
          }, width)
          await page.evaluate(
            ({ theme, density }) => {
              globalThis.document.documentElement.dataset.theme = theme
              globalThis.document.documentElement.dataset.density = density
            },
            { theme, density }
          )
          const reconnect = pane.getByRole('button', { name: 'Reconnect', exact: true })
          // A real pointer hit must reach the button rather than xterm's canvas.
          await reconnect.click({ trial: true })
          const stageBounds = await pane.locator('.terminal-stage').boundingBox()
          const bannerBounds = await pane.locator('.terminal-exit').boundingBox()
          expect(bannerBounds.x).toBeGreaterThanOrEqual(stageBounds.x)
          expect(bannerBounds.x + bannerBounds.width).toBeLessThanOrEqual(
            stageBounds.x + stageBounds.width
          )
          await page.screenshot({
            path: join(evidenceDirectory, `ssh-disconnected-${theme}-${density}-${width}.png`)
          })
        }
      }
    }

    await writeFile(join(profileDirectory, 'offline'), '')
    const reconnect = pane.getByRole('button', { name: 'Reconnect', exact: true })
    await reconnect.click()
    await expect(reconnect).toBeDisabled()
    await expect(pane.locator('.terminal-exit')).toContainText('Reconnecting…')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-reconnecting.png') })
    await expect(pane.getByRole('alert')).toContainText('Host unreachable.')
    await expect(pane.getByRole('alert')).not.toContainText('agent-workspace-protocol-error')
    await expect(reconnect).toBeEnabled()
    await expect(pane).toHaveAttribute('data-terminal-id', oldTerminalId)
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('SSH_READY')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-reconnect-failed.png') })
    await rm(join(profileDirectory, 'offline'))
    await reconnect.click()
    await expect(pane).not.toHaveAttribute('data-terminal-id', oldTerminalId)
    await expect(pane.locator('.terminal-statusbar')).toContainText('Connected')
    await expect(pane.locator('.terminal-exit')).toHaveCount(0)
    await pane.getByRole('checkbox', { name: 'Screen reader mode' }).check()
    await pane.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('RECOVERED')
    await page.keyboard.press('Enter')
    await expect(pane.locator('.xterm-accessibility-tree')).toContainText('SSH_REPLY:RECOVERED')
    await page.screenshot({ path: join(evidenceDirectory, 'ssh-recovered.png') })
  } finally {
    await closeElectronApplication(application, { gracefulTimeoutMs: 10_000 })
    await rm(profileDirectory, { recursive: true, force: true })
  }
})
