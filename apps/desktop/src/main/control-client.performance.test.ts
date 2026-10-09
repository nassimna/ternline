import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, hostname, release, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vitest'

import {
  mutationResultSchema,
  terminalEventSchema,
  type TerminalEventMessage
} from '@agent-workspace/protocol-client'

import { DESKTOP_IPC } from '@agent-workspace/contracts/desktop/desktop-bridge'
import { NodeSidecar } from './node-sidecar'

const WARMUP_ITERATIONS = 10
const MEASURED_ITERATIONS = 40
const DISPATCH_P95_TARGET_MS = 10
const PERCEIVED_ECHO_P95_TARGET_MS = 50
const OUTPUT_TIMEOUT_MS = 2_000

describe('desktop to service terminal responsiveness', () => {
  it('keeps warmed PTY dispatch acknowledgements and perceived echo within Milestone 1 gates', async () => {
    const cache = process.env.RUNNER_TEMP ?? join(homedir(), '.cache', 'ternline-validation')
    await mkdir(cache, { recursive: true })
    const directory = await realpath(await mkdtemp(join(cache, 'terminal-performance-')))
    await chmod(directory, 0o700)
    const listeners = new Set<(event: TerminalEventMessage) => void>()
    const emit = (event: unknown): void => {
      const parsed = terminalEventSchema.parse(event)
      for (const listener of listeners) listener(parsed)
    }
    let sidecar: NodeSidecar | undefined
    let windowId: string | undefined
    let terminalId: string | undefined
    let tabId: string | undefined
    let workspaceId: string | undefined

    try {
      sidecar = await NodeSidecar.startNative({
        native: true,
        serverPath: resolve(process.cwd(), '..', 'server', 'dist', 'bin.mjs'),
        liveDatabasePath: join(directory, 'workspace.sqlite'),
        backupPath: join(directory, 'backup.sqlite'),
        sessionFilePath: join(directory, 'session.json'),
        defaultWorkingDirectory: directory
      })
      const topology = await sidecar.client.listWindows()
      windowId = topology.focusedWindowId
      await sidecar.reconcileHostingForTrustedOwner('registerHosting', windowId, 1)
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
                process.platform === 'win32'
                  ? ['cmd.exe', '/D', '/Q']
                  : ['/bin/sh', '-c', 'stty -echo; exec /bin/cat']
            }
          }
        ],
        emit
      )
      const result = mutationResultSchema.parse(opened.value)
      const updated = result.snapshot.workspaces.find(({ id }) => id === workspace.id)
      const pane = updated?.panes.find(({ id }) => id === workspace.selectedPaneId)
      const tab = updated?.tabs.find(({ id }) => id === pane?.selectedTabId)
      terminalId = tab?.content.kind === 'terminal' ? tab.content.runtimeSessionId : undefined
      if (!tab || !terminalId) throw new Error('The managed terminal was not created')
      workspaceId = workspace.id
      tabId = tab.id
      await sidecar.invokeDesktopCore(windowId, DESKTOP_IPC.terminalAttach, [terminalId], emit)

      for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
        await measureInput(sidecar, windowId, listeners, terminalId, markerFor('warmup', iteration))
        await measureResize(sidecar, windowId, terminalId, iteration)
      }

      const inputAcknowledgements: number[] = []
      const perceivedEchoes: number[] = []
      const resizeAcknowledgements: number[] = []
      for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration += 1) {
        const input = await measureInput(
          sidecar,
          windowId,
          listeners,
          terminalId,
          markerFor('measured', iteration)
        )
        inputAcknowledgements.push(input.acknowledgementMs)
        perceivedEchoes.push(input.echoMs)
        resizeAcknowledgements.push(await measureResize(sidecar, windowId, terminalId, iteration))
      }

      const inputSummary = summarize(inputAcknowledgements)
      const echoSummary = summarize(perceivedEchoes)
      const resizeSummary = summarize(resizeAcknowledgements)
      console.info(
        `[terminal-performance] runtime=node environment=${process.env.CI ? 'ci' : 'local'} ` +
          `platform=${process.platform}-${process.arch} cpus=${String(availableParallelism())} ` +
          `node=${process.version} samples=${String(MEASURED_ITERATIONS)} ` +
          `input-ack=${formatSummary(inputSummary)} ` +
          `input-to-output=${formatSummary(echoSummary)} ` +
          `resize-ack=${formatSummary(resizeSummary)}`
      )

      if (process.env.AGENT_WORKSPACE_PTY_RESULT) {
        await writeFile(
          process.env.AGENT_WORKSPACE_PTY_RESULT,
          `${JSON.stringify(
            {
              metrics: [
                resultMetric('pty.dispatch', inputAcknowledgements, DISPATCH_P95_TARGET_MS),
                resultMetric('pty.perceived_echo', perceivedEchoes, PERCEIVED_ECHO_P95_TARGET_MS),
                resultMetric('pty.resize_dispatch', resizeAcknowledgements, DISPATCH_P95_TARGET_MS)
              ],
              scenarios: [
                'rapid typing through the native Node service PTY',
                'repeated PTY resize dispatch'
              ]
            },
            null,
            2
          )}\n`
        )
      }

      // These acknowledgements cover sender-bound desktop dispatch, authenticated HTTP,
      // service dispatch, and completion of the PTY write/OS resize operation.
      expect(inputSummary.p95).toBeLessThanOrEqual(DISPATCH_P95_TARGET_MS)
      expect(resizeSummary.p95).toBeLessThanOrEqual(DISPATCH_P95_TARGET_MS)
      // Unix disables the terminal driver's local echo, so this measures input through the
      // child process and terminal.output delivery. On Windows, cmd.exe /Q output is the
      // closest available cross-platform integration path and can include console echo.
      expect(echoSummary.p95).toBeLessThanOrEqual(PERCEIVED_ECHO_P95_TARGET_MS)
    } finally {
      if (sidecar && windowId && workspaceId && tabId) {
        await sidecar
          .invokeDesktopCore(windowId, DESKTOP_IPC.tabClose, [{ workspaceId, tabId }], emit)
          .catch(() => undefined)
      }
      await sidecar?.stop()
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)
})

async function measureInput(
  sidecar: NodeSidecar,
  windowId: string,
  listeners: Set<(event: TerminalEventMessage) => void>,
  terminalId: string,
  marker: string
): Promise<{ acknowledgementMs: number; echoMs: number }> {
  const startedAt = performance.now()
  const outputAt = waitForTerminalOutput(listeners, terminalId, marker)
  const data = process.platform === 'win32' ? `echo ${marker}\r\n` : `${marker}\n`
  await sidecar.invokeDesktopCore(
    windowId,
    DESKTOP_IPC.terminalSend,
    [terminalId, data],
    () => undefined
  )
  const acknowledgedAt = performance.now()

  return {
    acknowledgementMs: acknowledgedAt - startedAt,
    echoMs: (await outputAt) - startedAt
  }
}

async function measureResize(
  sidecar: NodeSidecar,
  windowId: string,
  terminalId: string,
  iteration: number
): Promise<number> {
  const startedAt = performance.now()
  await sidecar.invokeDesktopCore(
    windowId,
    DESKTOP_IPC.terminalResize,
    [terminalId, 24 + (iteration % 2), 80 + (iteration % 3)],
    () => undefined
  )
  return performance.now() - startedAt
}

function waitForTerminalOutput(
  listeners: Set<(event: TerminalEventMessage) => void>,
  terminalId: string,
  expected: string
): Promise<number> {
  return new Promise((resolveOutput, rejectOutput) => {
    let text = ''
    let removeListener = (): void => undefined
    const timeout = setTimeout(() => {
      removeListener()
      rejectOutput(new Error(`Timed out waiting for terminal output: ${expected}`))
    }, OUTPUT_TIMEOUT_MS)
    const listener = (event: TerminalEventMessage): void => {
      if (event.event !== 'terminal.output' || event.data.terminalId !== terminalId) {
        return
      }
      text += Buffer.from(event.data.chunk.data, 'base64').toString('utf8')
      if (text.includes(expected)) {
        clearTimeout(timeout)
        removeListener()
        resolveOutput(performance.now())
      }
    }
    listeners.add(listener)
    removeListener = () => {
      listeners.delete(listener)
    }
  })
}

function markerFor(phase: string, iteration: number): string {
  return `__agent_workspace_${phase}_${String(iteration).padStart(2, '0')}__`
}

function summarize(samples: readonly number[]): { p50: number; p95: number } {
  const ordered = [...samples].sort((left, right) => left - right)
  return {
    p50: percentile(ordered, 0.5),
    p95: percentile(ordered, 0.95)
  }
}

function percentile(orderedSamples: readonly number[], percentileValue: number): number {
  const index = Math.ceil(percentileValue * orderedSamples.length) - 1
  return orderedSamples[Math.max(0, index)] ?? Number.NaN
}

function formatSummary(summary: { p50: number; p95: number }): string {
  return `p50:${summary.p50.toFixed(2)}ms,p95:${summary.p95.toFixed(2)}ms`
}

function resultMetric(id: string, samples: readonly number[], target: number): object {
  const summary = summarize(samples)
  return {
    id,
    unit: 'ms',
    samples,
    summary: {
      min: Math.min(...samples),
      p50: summary.p50,
      p95: summary.p95,
      max: Math.max(...samples)
    },
    threshold: { operator: '<=', statistic: 'p95', value: target },
    gate: 'required',
    passed: summary.p95 <= target,
    notes: [
      `native Node service on ${process.platform}-${process.arch}`,
      `kernel ${release()}; host ${hostname()}`
    ]
  }
}
