import { randomUUID } from 'node:crypto'

import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { describe, expect, it, vi } from 'vitest'

import { closePane, closeTab, closeWorkspace, createWorkspace } from './workspace-mutations'
import { projectApplicationSnapshot } from './application-projection'
import { saveLayout } from './layout-mutations'

import { TerminalService, type PtyProcess } from '../terminal/terminal-service'
import type { ApplicationStateStore } from '../persistence/application-state-store'
import { serviceLogger } from '../logging/service-logger'
import { WorkspaceTerminalRuntime } from './workspace-terminal-runtime'
import { duplicateTabExact } from './advanced-tab-duplicate'

class FakePty implements PtyProcess {
  public readonly pid = 123
  public killed = false

  public onData(): { dispose(): void } {
    return { dispose() {} }
  }

  public onExit(): { dispose(): void } {
    return { dispose() {} }
  }

  public write(): void {}
  public resize(): void {}
  public kill(): void {
    this.killed = true
  }
}

function snapshot() {
  const workspaceId = randomUUID()
  const paneId = randomUUID()
  const terminalIds = [randomUUID(), randomUUID()]
  const browserId = randomUUID()
  const tabs: Record<string, unknown> = Object.fromEntries(
    terminalIds.map((id) => [
      id,
      {
        id,
        paneId,
        title: 'Terminal',
        customTitle: null,
        content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } },
        createdAt: 1
      }
    ])
  )
  tabs[browserId] = {
    id: browserId,
    paneId,
    title: 'Browser',
    customTitle: null,
    content: { kind: 'browser', metadata: { url: 'https://example.com/' } },
    createdAt: 1
  }
  return {
    state: durableApplicationStateSchema.parse({
      revision: 0,
      workspaces: [
        {
          id: workspaceId,
          name: 'fixture',
          description: null,
          color: null,
          workingDirectory: '/tmp',
          environment: { TL_WORKSPACE_ENV: 'inherited value', AGENT_WORKSPACE_TAB_ID: 'untrusted' },
          layout: { kind: 'leaf', paneId },
          selectedPaneId: paneId,
          panes: {
            [paneId]: {
              id: paneId,
              tabs: [...terminalIds, browserId],
              selectedTabId: terminalIds[0],
              title: null
            }
          },
          tabs,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      selectedWorkspaceId: workspaceId,
      workspaceSelection: [workspaceId],
      workspacePins: [],
      workspaceGroups: [],
      workspaceGroupAssignments: {},
      savedLayouts: [],
      legacyOverLimit: null,
      shortcutOverrides: {},
      notifications: [],
      notificationSettings: { systemEnabled: true, includeBody: false },
      recentlyClosed: [],
      windowPlacements: [
        {
          id: workspaceId,
          label: 'Main',
          workspaceIds: [workspaceId],
          focusedWorkspaceId: workspaceId,
          hostingState: 'unhosted',
          revision: 0
        }
      ],
      focusedWindowId: workspaceId,
      focusHistory: { entries: [], cursor: 0 }
    }),
    workspaceId,
    paneId,
    terminalIds,
    browserId
  }
}

describe('initial workspace mutations', () => {
  it('creates a workspace with explicit metadata and durable terminal launch settings', () => {
    const { state } = snapshot()
    const ids = { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() }
    const { workspaceId, paneId, tabId } = ids
    const metadata = {
      name: 'Development',
      description: 'Project tools',
      color: '#aabbcc',
      workingDirectory: '/workspace',
      environment: { PROJECT: 'ternline' },
      ssh: { host: 'dev-alias', user: 'deploy', port: 2222 }
    }
    const launch = { cwd: '/workspace/tools', rows: 35, cols: 112 }
    const next = createWorkspace(
      state,
      { ...metadata, initialTerminal: { ...launch, command: ['sh'] } },
      ids,
      2
    )

    expect(JSON.stringify(next.workspaces[1])).toBe(
      JSON.stringify({
        id: workspaceId,
        ...metadata,
        layout: { kind: 'leaf', paneId },
        selectedPaneId: paneId,
        panes: { [paneId]: { id: paneId, tabs: [tabId], selectedTabId: tabId, title: null } },
        tabs: {
          [tabId]: {
            id: tabId,
            paneId,
            title: 'Terminal',
            customTitle: null,
            content: { kind: 'terminal', launch },
            createdAt: 2
          }
        },
        createdAt: 2,
        updatedAt: 2
      })
    )
  })

  it.each([
    { mode: 'the lowest-ID terminal', withTerminals: true, rows: 41, cols: 123 },
    { mode: 'defaults with no terminal', withTerminals: false, rows: 24, cols: 80 }
  ])(
    'uses $mode for replacement dimensions when closing the last workspace',
    ({ withTerminals, rows, cols }) => {
      const fixture = snapshot()
      const closing = fixture.state.workspaces[0]!
      closing.description = 'Old description'
      closing.color = '#112233'
      closing.workingDirectory = '/workspace'
      closing.ssh = { host: 'dev-alias', user: 'deploy', port: 2222 }
      const pane = closing.panes[fixture.paneId]!
      const [lowerId, higherId] = fixture.terminalIds.toSorted((a, b) => a.localeCompare(b))
      const browser = closing.tabs[fixture.browserId]!
      if (withTerminals) {
        const lowest = closing.tabs[lowerId!]!
        lowest.content = {
          kind: 'terminal',
          launch: { cwd: '/workspace/tools', rows: 41, cols: 123 }
        }
        closing.tabs = {
          [higherId!]: closing.tabs[higherId!]!,
          [lowest.id]: lowest,
          [browser.id]: browser
        }
        pane.tabs = [higherId!, lowerId!, fixture.browserId]
        pane.selectedTabId = higherId!
      } else {
        closing.tabs = { [browser.id]: browser }
        pane.tabs = [fixture.browserId]
        pane.selectedTabId = fixture.browserId
      }
      const workspaceId = randomUUID()
      const paneId = randomUUID()
      const tabId = randomUUID()
      const next = closeWorkspace(
        fixture.state,
        fixture.workspaceId,
        { workspaceId, paneId, tabId },
        3
      )

      expect(next.workspaces).toHaveLength(1)
      expect(JSON.stringify(next.workspaces[0])).toBe(
        JSON.stringify({
          id: workspaceId,
          name: 'Workspace 1',
          description: null,
          color: null,
          workingDirectory: '/workspace',
          environment: closing.environment,
          layout: { kind: 'leaf', paneId },
          selectedPaneId: paneId,
          panes: { [paneId]: { id: paneId, tabs: [tabId], selectedTabId: tabId, title: null } },
          tabs: {
            [tabId]: {
              id: tabId,
              paneId,
              title: 'Terminal',
              customTitle: null,
              content: { kind: 'terminal', launch: { cwd: '/workspace', rows, cols } },
              createdAt: 3
            }
          },
          createdAt: 3,
          updatedAt: 3
        })
      )
    }
  )

  it.each([
    { operation: 'tab', source: 'terminal', rows: 41, cols: 123 },
    { operation: 'tab', source: 'browser', rows: 24, cols: 80 },
    { operation: 'pane', source: 'terminal', rows: 41, cols: 123 },
    { operation: 'pane', source: 'browser', rows: 24, cols: 80 }
  ])('replaces the final $operation with a $source source', ({ operation, source, rows, cols }) => {
    const { state, workspaceId, paneId, terminalIds, browserId } = snapshot()
    const workspace = state.workspaces[0]!
    const pane = workspace.panes[paneId]!
    workspace.workingDirectory = '/workspace'
    pane.title = 'Tools'
    if (source === 'terminal') {
      const [lowerId, higherId] = terminalIds.toSorted((a, b) => a.localeCompare(b))
      const lowest = workspace.tabs[lowerId!]!
      lowest.content = {
        kind: 'terminal',
        launch: { cwd: '/workspace/tools', rows: 41, cols: 123 }
      }
      pane.tabs = operation === 'tab' ? [lowest.id] : [higherId!, lowest.id]
    } else {
      pane.tabs = [browserId]
    }
    pane.selectedTabId = pane.tabs[0]!
    workspace.tabs = Object.fromEntries(pane.tabs.map((id) => [id, workspace.tabs[id]!]))

    const original = structuredClone(state)
    const replacementTabId = randomUUID()
    const now = 3
    const next =
      operation === 'tab'
        ? closeTab(state, workspaceId, pane.selectedTabId, randomUUID(), replacementTabId, now)
        : closePane(state, workspaceId, paneId, replacementTabId, now)

    expect(next.workspaces[0]!.tabs).toStrictEqual({
      [replacementTabId]: {
        id: replacementTabId,
        paneId,
        title: 'Terminal',
        customTitle: null,
        content: { kind: 'terminal', launch: { cwd: '/workspace', rows, cols } },
        createdAt: now
      }
    })
    expect(next.workspaces[0]!.panes).toStrictEqual({
      [paneId]: {
        id: paneId,
        tabs: [replacementTabId],
        selectedTabId: replacementTabId,
        title: operation === 'tab' ? 'Tools' : null
      }
    })
    expect(state).toStrictEqual(original)
  })
})

describe('WorkspaceTerminalRuntime', () => {
  it.each(['closeWorkspace', 'closeWindowWorkspaces'] as const)(
    '%s retires terminals in order after a fresh commit even if the first close fails',
    async (method) => {
      const { state, workspaceId, terminalIds } = snapshot()
      const other = snapshot().state
      state.workspaces.push(other.workspaces[0]!)
      state.windowPlacements.push(other.windowPlacements[0]!)
      const service = new TerminalService({ spawn: () => Promise.resolve(new FakePty()) })
      const runtime = new WorkspaceTerminalRuntime(service)
      const idempotencyEpoch = randomUUID()
      const result = {
        revision: 1,
        replacementWorkspaceId: null,
        replacementPaneId: null,
        replacementTabId: null,
        idempotencyEpoch,
        closedWindowId: workspaceId
      }
      const commit = vi
        .fn()
        .mockReturnValueOnce({ ...result, replayed: true })
        .mockReturnValueOnce({ ...result, replayed: false })
      const store = {
        exclusive: (operation: () => unknown) => operation(),
        readSnapshot: () => state,
        preflightWorkspaceClose: () => null,
        commitWorkspaceClose: commit,
        closeWindowWorkspaces: commit
      } as unknown as ApplicationStateStore
      const runClose = async () => {
        const mutation = {
          expectedRevision: state.revision,
          idempotencyEpoch,
          idempotencyKey: randomUUID()
        }
        return method === 'closeWorkspace'
          ? runtime.closeWorkspace(store, { ...mutation, workspaceId })
          : runtime.closeWindowWorkspaces(store, {
              mutation,
              policy: 'closeWorkspaces',
              window: { windowId: workspaceId, expectedRevision: 0 }
            })
      }
      const close = vi.spyOn(service, 'close')
      const warn = vi.spyOn(serviceLogger, 'emit').mockImplementation(() => {})
      try {
        await runtime.restore(state)
        const sessions = () => terminalIds.map((id) => runtime.sessionForTab(id))
        const [first, second] = sessions()
        expect(first).toBeDefined()
        expect(second).toBeDefined()

        expect(await runClose()).toMatchObject({ replayed: true })
        expect(close).not.toHaveBeenCalled()
        expect(sessions()).toEqual([first, second])

        commit.mockClear()
        close
          .mockImplementationOnce(() => {
            throw new Error('close failed')
          })
          .mockImplementationOnce(() => {})
        expect(await runClose()).toMatchObject({ replayed: false })
        expect(commit).toHaveBeenCalledBefore(close)
        expect(close.mock.calls).toEqual([[first], [second]])
        expect(sessions()).toEqual([undefined, undefined])
        expect(warn.mock.calls).toEqual([['warn', 'workspaceTerminalCleanupFailed']])
      } finally {
        close.mockRestore()
        warn.mockRestore()
        service.dispose()
      }
    }
  )

  it('rejects disconnected SSH workspace creation before spawning or committing, including CLI/API calls', async () => {
    const fixture = snapshot()
    const spawn = vi.fn().mockResolvedValue(new FakePty())
    const service = new TerminalService({ spawn })
    const checkConnection = vi.fn().mockRejectedValue(new Error('Permission denied'))
    const runtime = new WorkspaceTerminalRuntime(service, Date.now, checkConnection)
    const commit = vi.fn<ApplicationStateStore['commitWorkspaceCreate']>()
    const store = {
      exclusive: (operation: () => Promise<unknown>) => operation(),
      preflightWorkspaceCreate: () => null,
      commitWorkspaceCreate: commit
    } as unknown as ApplicationStateStore
    try {
      await runtime.restore(fixture.state)
      spawn.mockClear()
      const request = {
        name: 'SSH',
        workingDirectory: '/tmp',
        ssh: { host: 'prod', user: 'deploy', port: 22 },
        initialTerminal: { cwd: '/tmp', rows: 24, cols: 80 },
        expectedRevision: fixture.state.revision,
        idempotencyEpoch: randomUUID(),
        idempotencyKey: randomUUID()
      }
      await expect(runtime.createWorkspace(store, request)).rejects.toThrow('Permission denied')
      expect(checkConnection).toHaveBeenCalledWith(request.ssh)
      expect(spawn).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
      checkConnection.mockResolvedValue(undefined)
      commit.mockImplementation((_request, ids) => ({ ...ids, revision: 1, replayed: false }))
      await expect(runtime.createWorkspace(store, request)).resolves.toMatchObject({
        replayed: false
      })
      expect(spawn).toHaveBeenCalledWith('ssh', ['deploy@prod'], expect.anything())
      expect(commit).toHaveBeenCalledOnce()
    } finally {
      service.dispose()
    }
  })

  it('keeps the existing SSH terminal when reconnect fails and replaces it after a successful retry', async () => {
    const fixture = snapshot()
    const ssh = { host: 'fixture-host', user: '', port: 22 }
    fixture.state.workspaces[0]!.ssh = ssh
    const processes: FakePty[] = []
    const spawn = vi.fn(() => {
      const process = new FakePty()
      processes.push(process)
      return Promise.resolve(process)
    })
    const service = new TerminalService({ spawn })
    const close = vi.spyOn(service, 'close')
    const checkConnection = vi.fn().mockRejectedValue(new Error('Host unreachable'))
    const runtime = new WorkspaceTerminalRuntime(service, Date.now, checkConnection)
    const commit = vi.fn().mockReturnValue({ revision: 1, replayed: false })
    const store = {
      exclusive: (operation: () => Promise<unknown>) => operation(),
      preflightTerminalRestart: () => null,
      readSnapshot: () => fixture.state,
      commitTerminalRestart: commit
    } as unknown as ApplicationStateStore
    try {
      await runtime.restore(fixture.state)
      const tabId = fixture.terminalIds[0]!
      const oldId = runtime.sessionForTab(tabId)
      spawn.mockClear()
      const request = {
        workspaceId: fixture.workspaceId,
        tabId,
        expectedRevision: 0,
        idempotencyEpoch: randomUUID(),
        idempotencyKey: randomUUID()
      }
      await expect(runtime.restartTerminal(store, request)).rejects.toThrow('Host unreachable')
      expect(checkConnection).toHaveBeenCalledWith(ssh)
      expect(runtime.sessionForTab(tabId)).toBe(oldId)
      expect(processes.every((process) => !process.killed)).toBe(true)
      expect(spawn).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
      checkConnection.mockResolvedValue(undefined)
      const result = await runtime.restartTerminal(store, request)
      expect(result.terminalId).not.toBe(oldId)
      expect(runtime.sessionForTab(tabId)).toBe(result.terminalId)
      expect(close).toHaveBeenCalledWith(oldId)
      expect(processes.filter((process) => process.killed)).toHaveLength(1)
      expect(spawn).toHaveBeenCalledOnce()
      expect(commit).toHaveBeenCalledOnce()
    } finally {
      service.dispose()
    }
  })

  it('persists SSH profiles and restores every terminal on the SSH machine', async () => {
    const fixture = snapshot()
    const browser = fixture.state.workspaces[0]!.tabs[fixture.browserId]!.content
    if (browser.kind === 'browser') browser.metadata.browserSessionId = randomUUID()
    const ssh = {
      host: 'prod-alias',
      user: 'deploy',
      port: 2222,
      identityFile: '/home/alex/.ssh/deploy key'
    }
    const ids = { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() }
    const state = createWorkspace(
      fixture.state,
      {
        name: 'SSH',
        workingDirectory: '/tmp',
        ssh,
        initialTerminal: { cwd: '/tmp', rows: 24, cols: 80 }
      },
      ids,
      2
    )
    const restored = durableApplicationStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(restored.workspaces.find((item) => item.id === ids.workspaceId)?.ssh).toEqual(ssh)
    expect(
      projectApplicationSnapshot(restored).workspaces.find((item) => item.id === ids.workspaceId)
        ?.ssh
    ).toEqual(ssh)
    const launches: Array<{ command: string; args: string[] }> = []
    const service = new TerminalService({
      spawn: (command, args) => {
        launches.push({ command, args })
        return Promise.resolve(new FakePty())
      }
    })
    try {
      const runtime = new WorkspaceTerminalRuntime(service)
      await runtime.restore(restored)
      expect(launches.filter((item) => item.command === 'ssh')).toEqual([
        {
          command: 'ssh',
          args: ['-i', '/home/alex/.ssh/deploy key', '-p', '2222', 'deploy@prod-alias']
        }
      ])
      const prepared = await runtime.recentlyClosedAdapter().prepare({
        workspaceId: ids.workspaceId,
        paneId: ids.paneId,
        tabId: randomUUID(),
        launch: { cwd: '/tmp', rows: 24, cols: 80 },
        ssh: { host: 'prod-alias', user: '', port: 22 }
      })
      expect(launches.at(-1)).toEqual({ command: 'ssh', args: ['prod-alias'] })
      prepared.close()
    } finally {
      service.dispose()
    }
  })

  it('persists workspace environment across durable snapshots and saved layouts', () => {
    const fixture = snapshot()
    const ids = { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() }
    const environment = { FOO: 'bar', MULTILINE: 'first\nsecond' }
    const created = createWorkspace(
      fixture.state,
      {
        name: 'Environment',
        workingDirectory: '/tmp',
        environment,
        initialTerminal: { cwd: '/tmp', rows: 24, cols: 80 }
      },
      ids,
      2
    )
    const restored = durableApplicationStateSchema.parse(JSON.parse(JSON.stringify(created)))
    expect(
      restored.workspaces.find((workspace) => workspace.id === ids.workspaceId)?.environment
    ).toEqual(environment)
    const saved = saveLayout(restored, randomUUID(), 'Environment', [ids.workspaceId], 3)
    expect(saved.savedLayouts[0]?.template.workspaces[0]?.environment).toEqual(environment)
  })

  it('duplicates a browser with a fresh runtime identity and preserves its source', () => {
    const fixture = snapshot()
    const state = durableApplicationStateSchema.parse({
      ...fixture.state,
      windowPlacements: fixture.state.windowPlacements.map((placement) => ({
        ...placement,
        hostingState: 'hosted' as const
      }))
    })
    const tabId = randomUUID()
    const browserSessionId = randomUUID()
    const request = {
      mutation: {
        expectedRevision: state.revision,
        idempotencyEpoch: randomUUID(),
        idempotencyKey: randomUUID()
      },
      source: {
        windowId: fixture.workspaceId,
        workspaceId: fixture.workspaceId,
        paneId: fixture.paneId,
        tabId: fixture.browserId,
        expectedWindowRevision: 0
      },
      target: {
        windowId: fixture.workspaceId,
        workspaceId: fixture.workspaceId,
        paneId: fixture.paneId,
        destinationIndex: 1,
        expectedWindowRevision: 0
      }
    }
    const next = duplicateTabExact(state, request, { tabId, browserSessionId }, 2)
    const workspace = next.workspaces[0]!
    expect(workspace.tabs[fixture.browserId]).toEqual(state.workspaces[0]!.tabs[fixture.browserId])
    expect(workspace.tabs[tabId]?.content).toMatchObject({
      kind: 'browser',
      metadata: { browserSessionId, url: 'https://example.com/' }
    })
    expect(next.windowPlacements[0]?.revision).toBe(1)
    expect(next.revision).toBe(state.revision + 1)
    expect(() =>
      duplicateTabExact(next, request, { tabId: randomUUID(), browserSessionId: randomUUID() }, 3)
    ).toThrow('Window placement changed')
  })
  it('restores only terminal tabs with their durable ownership context', async () => {
    const fixture = snapshot()
    const processes: FakePty[] = []
    const environments: NodeJS.ProcessEnv[] = []
    const service = new TerminalService({
      spawn: (_command, _args, options) => {
        environments.push(options.env)
        const pty = new FakePty()
        processes.push(pty)
        return Promise.resolve(pty)
      }
    })
    const runtime = new WorkspaceTerminalRuntime(service)
    await runtime.restore(fixture.state)
    expect(processes).toHaveLength(2)
    expect(runtime.sessionForTab(fixture.browserId)).toBeUndefined()
    for (const tabId of fixture.terminalIds) {
      const sessionId = runtime.sessionForTab(tabId)
      expect(sessionId).toBeDefined()
      expect(service.attach(sessionId!).terminal.cwd).toBe('/tmp')
      expect(environments).toContainEqual(
        expect.objectContaining({
          TL_WORKSPACE_ENV: 'inherited value',
          AGENT_WORKSPACE_WORKSPACE_ID: fixture.workspaceId,
          AGENT_WORKSPACE_PANE_ID: fixture.paneId,
          AGENT_WORKSPACE_TAB_ID: tabId
        })
      )
    }
    await expect(runtime.restore(fixture.state)).rejects.toThrow('already starting')
    service.dispose()
    expect(processes.every((pty) => pty.killed)).toBe(true)
  })

  it('terminates earlier PTYs if a later restore launch fails', async () => {
    const fixture = snapshot()
    const first = new FakePty()
    let attempts = 0
    const service = new TerminalService({
      spawn: () => {
        attempts += 1
        return attempts === 1 ? Promise.resolve(first) : Promise.reject(new Error('spawn failed'))
      }
    })
    const runtime = new WorkspaceTerminalRuntime(service)
    await expect(runtime.restore(fixture.state)).rejects.toThrow('spawn failed')
    expect(first.killed).toBe(true)
    expect(fixture.terminalIds.every((id) => runtime.sessionForTab(id) === undefined)).toBe(true)
    service.dispose()
  })

  it('rebinds a detached agent terminal and rolls back a staged PTY if the tab changes', async () => {
    const fixture = snapshot()
    let current = fixture.state
    let changeOnNextSpawn = false
    const processes: FakePty[] = []
    const service = new TerminalService({
      spawn: () => {
        const pty = new FakePty()
        processes.push(pty)
        if (changeOnNextSpawn) {
          current = {
            ...current,
            workspaces: current.workspaces.map((workspace) =>
              workspace.id === fixture.workspaceId
                ? {
                    ...workspace,
                    tabs: {
                      ...workspace.tabs,
                      [fixture.terminalIds[0]!]: {
                        ...workspace.tabs[fixture.terminalIds[0]!]!,
                        paneId: randomUUID()
                      }
                    }
                  }
                : workspace
            )
          }
        }
        return Promise.resolve(pty)
      }
    })
    const runtime = new WorkspaceTerminalRuntime(service)
    const store = { readSnapshot: () => current } as ApplicationStateStore
    const tabId = fixture.terminalIds[0]!
    const launch = fixture.state.workspaces[0]!.tabs[tabId]!.content
    if (launch.kind !== 'terminal') throw new Error('Expected terminal fixture')
    const resume = () =>
      runtime.replaceAgentTerminal(
        store,
        fixture.workspaceId,
        fixture.paneId,
        tabId,
        launch.launch,
        ['codex', 'resume'],
        'resumeDetached'
      )
    try {
      await runtime.restore(fixture.state)
      const detachedId = runtime.sessionForTab(tabId)!
      service.close(detachedId)
      expect(runtime.sessionForTab(tabId)).toBeUndefined()
      await expect(
        runtime.replaceAgentTerminal(
          store,
          fixture.workspaceId,
          fixture.paneId,
          tabId,
          launch.launch,
          ['codex', 'resume']
        )
      ).rejects.toThrow('Terminal runtime is not attached')
      await resume()
      const resumedId = runtime.sessionForTab(tabId)
      expect(resumedId).toBeDefined()
      expect(resumedId).not.toBe(detachedId)
      expect(runtime.sessionForTab(fixture.terminalIds[1]!)).toBeDefined()

      await resume()
      const replacedId = runtime.sessionForTab(tabId)
      expect(replacedId).toBeDefined()
      expect(replacedId).not.toBe(resumedId)
      expect(() => service.attach(resumedId!)).toThrow('Terminal does not exist')

      service.close(replacedId!)
      expect(runtime.sessionForTab(tabId)).toBeUndefined()
      const originalSpawn = processes.length
      changeOnNextSpawn = true
      await expect(resume()).rejects.toThrow('Exact terminal binding changed')
      expect(processes[originalSpawn]?.killed).toBe(true)
      expect(runtime.sessionForTab(tabId)).toBeUndefined()
    } finally {
      service.dispose()
    }
  })
})
