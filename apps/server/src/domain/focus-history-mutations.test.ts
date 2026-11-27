import { randomUUID } from 'node:crypto'
import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { navigateFocusHistory } from './focus-history-mutations'
import { WindowMutationError } from './window-mutations'
import {
  WorkspaceMutationError,
  closeTab,
  closeWorkspace,
  createWorkspace,
  openBrowserTab,
  openTerminalTab,
  restartTerminal,
  selectTab,
  splitPane,
  updateTab
} from './workspace-mutations'

function createTwoWorkspaceState() {
  const windowId = randomUUID()
  const workspaceIds = [randomUUID(), randomUUID()]
  const paneIds = [randomUUID(), randomUUID()]
  const tabIds = [randomUUID(), randomUUID()]
  const targets = workspaceIds.map((workspaceId, index) => ({
    windowId,
    workspaceId,
    paneId: paneIds[index]!,
    tabId: tabIds[index]!
  }))
  const state = durableApplicationStateSchema.parse({
    revision: 3,
    workspaces: workspaceIds.map((id, index) => ({
      id,
      name: `Workspace ${index + 1}`,
      description: null,
      color: null,
      workingDirectory: '/tmp',
      layout: { kind: 'leaf', paneId: paneIds[index] },
      selectedPaneId: paneIds[index],
      panes: {
        [paneIds[index]!]: {
          id: paneIds[index],
          tabs: [tabIds[index]],
          selectedTabId: tabIds[index],
          title: null
        }
      },
      tabs: {
        [tabIds[index]!]: {
          id: tabIds[index],
          paneId: paneIds[index],
          title: 'Terminal',
          customTitle: null,
          content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } },
          createdAt: 1
        }
      },
      createdAt: 1,
      updatedAt: 1
    })),
    selectedWorkspaceId: workspaceIds[1],
    workspaceSelection: [workspaceIds[1]],
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
        id: windowId,
        label: 'Main',
        workspaceIds,
        focusedWorkspaceId: workspaceIds[1],
        hostingState: 'hosted',
        revision: 2
      }
    ],
    focusedWindowId: windowId,
    focusHistory: { entries: targets, cursor: 1 }
  })
  return { state, targets, workspaceIds }
}

describe.each<{ name: string; mutate: typeof restartTerminal }>([
  {
    name: 'closeTab',
    mutate: (state, workspaceId, tabId, now) =>
      closeTab(state, workspaceId, tabId, randomUUID(), null, now)
  },
  { name: 'restartTerminal', mutate: restartTerminal },
  { name: 'selectTab', mutate: selectTab },
  {
    name: 'updateTab',
    mutate: (state, workspaceId, tabId, now) =>
      updateTab(state, { workspaceId, tabId, title: 'Renamed' }, now)
  }
])('$name', ({ mutate }) => {
  it.each([
    ['workspace_not_found', 'Workspace does not exist'],
    ['tab_not_found', 'Tab does not exist']
  ])('throws %s before checking the timestamp', (code, message) => {
    const { state, targets } = createTwoWorkspaceState()
    const [first, second] = targets
    const snapshot = structuredClone(state)
    const workspaceId = code === 'workspace_not_found' ? randomUUID() : first!.workspaceId

    expect(() => mutate(state, workspaceId, second!.tabId, -1)).toThrow(
      expect.objectContaining({ constructor: WorkspaceMutationError, code, message })
    )
    expect(state).toEqual(snapshot)
  })
})

it('validates the tab update before looking up its workspace', () => {
  const { state, targets } = createTwoWorkspaceState()
  const input = { workspaceId: randomUUID(), tabId: targets[1]!.tabId, title: '' }
  const snapshot = structuredClone({ state, input })

  expect(() => updateTab(state, input, -1)).toThrow(ZodError)
  expect({ state, input }).toEqual(snapshot)
})

it('restarts a terminal without changing its durable tab or focus', () => {
  const { state, targets } = createTwoWorkspaceState()
  const { workspaceId, tabId } = targets[0]!
  const snapshot = structuredClone(state)
  const expected = structuredClone(state)
  expected.revision += 1
  expected.workspaces[0]!.updatedAt = 2

  expect(restartTerminal(state, workspaceId, tabId, 2)).toEqual(expected)
  expect(state).toEqual(snapshot)
})

it('updates tab titles and workspace time while preserving tab content and focus', () => {
  const { state, targets } = createTwoWorkspaceState()
  const { workspaceId, tabId } = targets[1]!
  const snapshot = structuredClone(state)
  const expected = structuredClone(state)
  const workspace = expected.workspaces[1]!
  workspace.tabs[tabId]!.title = 'Shell'
  workspace.tabs[tabId]!.customTitle = 'Dev'
  workspace.updatedAt = 2
  expected.revision += 1

  expect(
    updateTab(state, { workspaceId, tabId, title: 'Shell', customTitle: { value: 'Dev' } }, 2)
  ).toEqual(expected)
  expect(state).toEqual(snapshot)
})

it('moves backward and forward through durable focus without adding entries', () => {
  const { state, targets, workspaceIds } = createTwoWorkspaceState()
  const back = navigateFocusHistory(state, 'back')
  expect(back.target).toEqual(targets[0])
  expect(back.state).toMatchObject({
    revision: 4,
    selectedWorkspaceId: workspaceIds[0],
    focusHistory: { entries: targets, cursor: 0 }
  })
  expect(() => navigateFocusHistory(back.state, 'back')).toThrow(WindowMutationError)
  const forward = navigateFocusHistory(back.state, 'forward')
  expect(forward.target).toEqual(targets[1])
  expect(forward.state.revision).toBe(5)
  expect(forward.state.focusHistory.entries).toEqual(targets)
})

it('returns to the previous terminal and forward to the new browser tab', () => {
  const { state, targets } = createTwoWorkspaceState()
  const alpha = targets[1]!
  const { workspaceId, paneId } = alpha
  const betaId = randomUUID()
  const browserId = randomUUID()
  const withBeta = openTerminalTab(
    state,
    { workspaceId, paneId, launch: { cwd: '/tmp', rows: 24, cols: 80 } },
    betaId,
    2
  )
  const withBrowser = openBrowserTab(
    withBeta,
    { workspaceId, paneId, metadata: { url: 'https://example.com/' } },
    browserId,
    randomUUID(),
    3
  )

  const back = navigateFocusHistory(withBrowser, 'back')
  expect(back.target, `Back should target Beta (Alpha is ${alpha.tabId})`).toEqual({
    ...alpha,
    tabId: betaId
  })
  expect(navigateFocusHistory(back.state, 'forward').target).toEqual({
    ...alpha,
    tabId: browserId
  })
})

it.each(['terminal', 'browser'])('inserts a %s tab at index zero after going back', (kind) => {
  const { state, targets } = createTwoWorkspaceState()
  const [first, second] = targets
  const { workspaceId, paneId: targetPaneId } = second!
  const paneId = randomUUID()
  const existingTabId = randomUUID()
  const launch = { cwd: '/tmp', rows: 24, cols: 80 }
  const split = splitPane(
    state,
    {
      workspaceId,
      targetPaneId,
      axis: 'horizontal',
      ratio: 0.5,
      placement: 'after',
      content: { kind: 'newTerminal', launch }
    },
    { paneId, tabId: existingTabId, splitId: randomUUID(), browserSessionId: randomUUID() },
    2
  )
  const { state: source } = navigateFocusHistory(split, 'back')
  const snapshot = structuredClone(source)
  const tabId = randomUUID()
  const request = { workspaceId, paneId, destinationIndex: 0 }

  const next =
    kind === 'terminal'
      ? openTerminalTab(source, { ...request, launch }, tabId, 3)
      : openBrowserTab(
          source,
          { ...request, metadata: { url: 'https://example.com/' } },
          tabId,
          randomUUID(),
          3
        )

  expect(next.workspaces[1]).toMatchObject({
    selectedPaneId: paneId,
    panes: { [paneId]: { tabs: [tabId, existingTabId], selectedTabId: tabId } },
    updatedAt: 3
  })
  expect(next.focusHistory).toEqual({
    entries: [first, second, { ...second, paneId, tabId }],
    cursor: 2
  })
  expect(next.revision).toBe(6)
  expect(source).toEqual(snapshot)
})

it.each(['terminal', 'browser'])('preserves %s tab insertion validation order', (kind) => {
  const { state, targets } = createTwoWorkspaceState()
  const { workspaceId, paneId, tabId: existingTabId } = targets[1]!
  const snapshot = structuredClone(state)
  const newTabId = randomUUID()
  const browserSessionId = randomUUID()
  const launch = { cwd: '/tmp', rows: 24, cols: 80 }
  const open = (destinationIndex: number, tabId: string) => {
    const request = { workspaceId, paneId, destinationIndex }
    return kind === 'terminal'
      ? openTerminalTab(state, { ...request, launch }, tabId, -1)
      : openBrowserTab(
          state,
          { ...request, metadata: { url: 'https://example.com/' } },
          tabId,
          browserSessionId,
          -1
        )
  }

  expect(() => open(2, newTabId)).toThrow(
    expect.objectContaining({
      constructor: WorkspaceMutationError,
      code: 'index_out_of_bounds',
      message: 'Tab destination index is invalid'
    })
  )
  expect(() => open(1, newTabId)).toThrow(
    expect.objectContaining({
      constructor: WorkspaceMutationError,
      code: 'invalid_timestamp',
      message: 'Tab creation timestamp is invalid'
    })
  )
  expect(() => open(2, existingTabId)).toThrow(
    expect.objectContaining({
      constructor: WorkspaceMutationError,
      code: 'duplicate_identity',
      message: `${kind === 'terminal' ? 'Terminal' : 'Browser'} tab ID is in use`
    })
  )
  expect(state).toEqual(snapshot)
})

it('drops intervening forward history when selecting the former last tab', () => {
  const { state, targets } = createTwoWorkspaceState()
  const alpha = targets[1]!
  const bravoId = randomUUID()
  const charlieId = randomUUID()
  const input = {
    workspaceId: alpha.workspaceId,
    paneId: alpha.paneId,
    launch: { cwd: '/tmp', rows: 24, cols: 80 }
  }
  const withBravo = openTerminalTab(state, input, bravoId, 2)
  const withCharlie = openTerminalTab(withBravo, input, charlieId, 3)

  const backToBravo = navigateFocusHistory(withCharlie, 'back')
  expect(backToBravo.target.tabId).toBe(bravoId)
  const backToAlpha = navigateFocusHistory(backToBravo.state, 'back')
  expect(backToAlpha.target).toEqual(alpha)
  const snapshot = structuredClone(backToAlpha.state)

  const selected = selectTab(backToAlpha.state, alpha.workspaceId, charlieId, 4)

  expect(selected.focusHistory).toEqual({
    entries: [...targets, { ...alpha, tabId: charlieId }],
    cursor: 2
  })
  expect(navigateFocusHistory(selected, 'back').target.tabId).toBe(alpha.tabId)
  expect(backToAlpha.state).toEqual(snapshot)
})

it('drops forward history without duplicating the retained target when selecting a tab', () => {
  const { state, targets } = createTwoWorkspaceState()
  const first = targets[0]!
  const alpha = targets[1]!
  const { workspaceId, paneId } = alpha
  const tabId = randomUUID()
  const withTab = openTerminalTab(
    state,
    { workspaceId, paneId, launch: { cwd: '/tmp', rows: 24, cols: 80 } },
    tabId,
    2
  )
  const beta = { ...alpha, tabId }
  const source = durableApplicationStateSchema.parse({
    ...selectTab(withTab, workspaceId, alpha.tabId, 3),
    focusHistory: { entries: [first, beta, alpha], cursor: 1 }
  })
  const snapshot = structuredClone(source)

  const selected = selectTab(source, workspaceId, tabId, 4)

  expect(selected.focusHistory).toEqual({ entries: [first, beta], cursor: 1 })
  expect(source).toEqual(snapshot)
})

it.each(['empty', 'full'])('records a new workspace with %s focus history', (history) => {
  const { state, targets } = createTwoWorkspaceState()
  const entries =
    history === 'empty' ? [] : Array.from({ length: 128 }, (_, index) => targets[index % 2]!)
  state.focusHistory = { entries, cursor: history === 'empty' ? 0 : 127 }
  const snapshot = structuredClone(state)
  const ids = { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() }

  const next = createWorkspace(
    state,
    {
      name: 'New workspace',
      workingDirectory: '/tmp',
      initialTerminal: { cwd: '/tmp', rows: 24, cols: 80 }
    },
    ids,
    2
  )

  const prior = history === 'empty' ? [targets[1]] : entries.slice(1)
  expect(next.focusHistory).toEqual({
    entries: [...prior, { windowId: state.focusedWindowId, ...ids }],
    cursor: history === 'empty' ? 1 : 127
  })
  expect(state).toEqual(snapshot)
})

it('prunes a closed unfocused workspace from both sides of the focus history cursor', () => {
  const { state, targets } = createTwoWorkspaceState()
  const first = targets[0]!
  const second = targets[1]!
  state.focusHistory = { entries: [first, second, first, second], cursor: 1 }
  const source = structuredClone(state)

  const next = closeWorkspace(state, first.workspaceId)

  expect(next.selectedWorkspaceId).toBe(second.workspaceId)
  expect(next.focusHistory).toEqual({ entries: [second, second], cursor: 0 })
  expect(state).toEqual(source)
})

it('records the remaining workspace when closing the focused workspace clears history', () => {
  const { state, targets } = createTwoWorkspaceState()
  const first = targets[0]!
  const second = targets[1]!
  state.focusHistory = { entries: [second], cursor: 0 }
  const source = structuredClone(state)

  const next = closeWorkspace(state, second.workspaceId)

  expect(next.selectedWorkspaceId).toBe(first.workspaceId)
  expect(next.focusHistory).toEqual({ entries: [first], cursor: 0 })
  expect(state).toEqual(source)
})
