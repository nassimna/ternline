import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AgentWorkspaceClient } from '@agent-workspace/client-runtime'
import { DESKTOP_IPC } from '@agent-workspace/contracts/desktop/desktop-bridge'
import {
  mutationResultSchema,
  terminalAttachResultSchema,
  terminalEventSchema,
  type TerminalEventMessage
} from '@agent-workspace/protocol-client'

import { APPLICATION_ID } from './identity'
import { NodeSidecar } from './node-sidecar'

describe('desktop to Node service protocol', () => {
  it('authenticates and identifies the real Node service', async () => {
    const { directory, sidecar } = await startNativeFixture()
    try {
      const identity = await sidecar.client.identify()
      expect(identity.application).toBe(APPLICATION_ID)
      expect(identity.apiVersion).toBe(1)
      expect(identity.capabilities).toEqual(
        expect.arrayContaining(['terminal.attach', 'terminal.events', 'tab.openTerminal'])
      )
      const unauthenticated = new AgentWorkspaceClient(sidecar.baseUrl, 'incorrect-token')
      await expect(unauthenticated.identify()).rejects.toMatchObject({ status: 401 })
    } finally {
      await sidecar.stop()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it('reattaches to a live PTY and reconstructs checkpointed output without new output', async () => {
    const { directory, sidecar, windowId } = await startNativeFixture()
    const listeners = new Set<(event: TerminalEventMessage) => void>()
    const emit = (value: unknown): void => {
      const event = terminalEventSchema.parse(value)
      for (const listener of listeners) listener(event)
    }
    try {
      const { terminalId, tabId, workspaceId } = await openManagedTestTerminal(
        sidecar,
        windowId,
        directory
      )
      await sidecar.invokeDesktopCore(windowId, DESKTOP_IPC.terminalAttach, [terminalId], emit)
      const before = waitForTerminalOutput(listeners, terminalId, 'before-reload')
      await sendInput(sidecar, windowId, terminalId, 'before-reload')
      const first = await before
      await sidecar.invokeDesktopCore(
        windowId,
        DESKTOP_IPC.terminalCheckpoint,
        [
          terminalId,
          {
            sequence: first.sequence,
            rows: 24,
            cols: 80,
            activeBuffer: 'normal',
            data: 'serialized-before-reload'
          }
        ],
        emit
      )
      await sidecar.invokeDesktopCore(windowId, DESKTOP_IPC.terminalDetach, [terminalId], emit)
      let detachedOutput = false
      listeners.add(() => {
        detachedOutput = true
      })
      await sendInput(sidecar, windowId, terminalId, 'journal-before-attach')
      await waitForJournal(sidecar, terminalId, 'journal-before-attach')
      expect(detachedOutput).toBe(false)
      listeners.clear()
      const attached = await sidecar.invokeDesktopCore(
        windowId,
        DESKTOP_IPC.terminalAttach,
        [terminalId],
        emit
      )
      const snapshot = terminalAttachResultSchema.parse(attached.value)
      expect(snapshot.terminal.id).toBe(terminalId)
      expect(snapshot.terminal.exited).toBe(false)
      expect(snapshot.checkpoint?.data).toBe('serialized-before-reload')
      expect(
        snapshot.output.map((chunk) => Buffer.from(chunk.data, 'base64').toString('utf8')).join('')
      ).toContain('journal-before-attach')
      const visible = waitForTerminalOutput(listeners, terminalId, 'visible-after-attach')
      await sendInput(sidecar, windowId, terminalId, 'visible-after-attach')
      await visible
      await sidecar.invokeDesktopCore(
        windowId,
        DESKTOP_IPC.tabClose,
        [{ workspaceId, tabId }],
        emit
      )
    } finally {
      await sidecar.stop()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)

  it('reports a native TCP listener owned by a managed terminal', async () => {
    const { directory, sidecar, windowId } = await startNativeFixture()
    try {
      const program =
        "const net = require('node:net'); const server = net.createServer(); server.listen(0, '127.0.0.1')"
      const { terminalId, tabId, workspaceId } = await openManagedTestTerminal(
        sidecar,
        windowId,
        directory,
        [process.execPath, '-e', program]
      )
      const deadline = Date.now() + 5_000
      let metadata = await sidecar.client.runtimeMetadata(terminalId)
      while (metadata.listeningPorts.length === 0 && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
        metadata = await sidecar.client.runtimeMetadata(terminalId)
      }
      expect(metadata.listeningPorts).toHaveLength(1)
      expect(metadata.listeningPorts[0]).toBeGreaterThan(0)
      await sidecar.invokeDesktopCore(
        windowId,
        DESKTOP_IPC.tabClose,
        [{ workspaceId, tabId }],
        () => undefined
      )
    } finally {
      await sidecar.stop()
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})

async function startNativeFixture() {
  const cache = process.env.RUNNER_TEMP ?? join(homedir(), '.cache', 'ternline-validation')
  await mkdir(cache, { recursive: true })
  const directory = await realpath(await mkdtemp(join(cache, 'desktop-protocol-')))
  await chmod(directory, 0o700)
  try {
    const sidecar = await NodeSidecar.startNative({
      native: true,
      serverPath: resolve(process.cwd(), '..', 'server', 'dist', 'bin.mjs'),
      liveDatabasePath: join(directory, 'workspace.sqlite'),
      backupPath: join(directory, 'backup.sqlite'),
      sessionFilePath: join(directory, 'session.json'),
      defaultWorkingDirectory: directory
    })
    try {
      const topology = await sidecar.client.listWindows()
      await sidecar.reconcileHostingForTrustedOwner('registerHosting', topology.focusedWindowId, 1)
      return { directory, sidecar, windowId: topology.focusedWindowId }
    } catch (error) {
      await sidecar.stop()
      throw error
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function openManagedTestTerminal(
  sidecar: NodeSidecar,
  windowId: string,
  directory: string,
  command?: string[]
) {
  const initial = (await sidecar.client.listWorkspaces()).snapshot
  const workspace = initial.workspaces.find(({ id }) => id === initial.selectedWorkspaceId)
  if (!workspace) throw new Error('The selected workspace is missing')
  const opened = await sidecar.invokeDesktopCore(
    windowId,
    DESKTOP_IPC.tabOpenTerminal,
    [
      {
        workspaceId: workspace.id,
        paneId: workspace.selectedPaneId,
        launch: {
          cwd: directory,
          rows: 24,
          cols: 80,
          command:
            command ??
            (process.platform === 'win32'
              ? ['cmd.exe', '/Q']
              : ['/bin/sh', '-c', 'stty -echo; exec /bin/cat'])
        }
      }
    ],
    () => undefined
  )
  const updated = mutationResultSchema
    .parse(opened.value)
    .snapshot.workspaces.find(({ id }) => id === workspace.id)
  const pane = updated?.panes.find(({ id }) => id === workspace.selectedPaneId)
  const tab = updated?.tabs.find(({ id }) => id === pane?.selectedTabId)
  const terminalId = tab?.content.kind === 'terminal' ? tab.content.runtimeSessionId : undefined
  if (!tab || !terminalId) throw new Error('The managed terminal was not created')
  return { terminalId, tabId: tab.id, workspaceId: workspace.id }
}

function sendInput(sidecar: NodeSidecar, windowId: string, terminalId: string, marker: string) {
  return sidecar.invokeDesktopCore(
    windowId,
    DESKTOP_IPC.terminalSend,
    [terminalId, process.platform === 'win32' ? `echo ${marker}\r\n` : `${marker}\n`],
    () => undefined
  )
}

async function waitForJournal(sidecar: NodeSidecar, terminalId: string, expected: string) {
  const deadline = Date.now() + 5_000
  do {
    const snapshot = await sidecar.client.attach(terminalId)
    if (
      snapshot.output.some((chunk) =>
        Buffer.from(chunk.data, 'base64').toString('utf8').includes(expected)
      )
    )
      return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
  } while (Date.now() < deadline)
  throw new Error('Timed out waiting for detached terminal journal')
}

function waitForTerminalOutput(
  listeners: Set<(event: TerminalEventMessage) => void>,
  terminalId: string,
  expected: string
): Promise<{ sequence: number }> {
  return new Promise((resolveOutput, rejectOutput) => {
    let text = ''
    const timeout = setTimeout(() => {
      listeners.delete(listener)
      rejectOutput(new Error(`Timed out waiting for terminal output: ${expected}`))
    }, 5_000)
    const listener = (event: TerminalEventMessage): void => {
      if (event.event !== 'terminal.output' || event.data.terminalId !== terminalId) return
      text += Buffer.from(event.data.chunk.data, 'base64').toString('utf8')
      if (text.includes(expected)) {
        clearTimeout(timeout)
        listeners.delete(listener)
        resolveOutput({ sequence: event.data.chunk.sequence })
      }
    }
    listeners.add(listener)
  })
}
