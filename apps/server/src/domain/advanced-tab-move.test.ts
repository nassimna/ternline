import { randomUUID } from 'node:crypto'
import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { expect, it } from 'vitest'

import { duplicateTabExact } from './advanced-tab-duplicate'
import { moveExactTab } from './advanced-tab-move'

function twoWindowFixture() {
  const sourceWindow = randomUUID()
  const targetWindow = randomUUID()
  const sourceWorkspace = randomUUID()
  const targetWorkspace = randomUUID()
  const sourcePane = randomUUID()
  const targetPane = randomUUID()
  const movedTab = randomUUID()
  const remainingTab = randomUUID()
  const targetTab = randomUUID()
  const terminal = (id: string, paneId: string) => ({
    id,
    paneId,
    title: 'Terminal',
    customTitle: null,
    content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } },
    createdAt: 1
  })
  const state = durableApplicationStateSchema.parse({
    revision: 4,
    workspaces: [
      {
        id: sourceWorkspace,
        name: 'Source',
        description: null,
        color: null,
        workingDirectory: '/tmp',
        layout: { kind: 'leaf', paneId: sourcePane },
        selectedPaneId: sourcePane,
        panes: {
          [sourcePane]: {
            id: sourcePane,
            tabs: [movedTab, remainingTab],
            selectedTabId: movedTab,
            title: null
          }
        },
        tabs: {
          [movedTab]: terminal(movedTab, sourcePane),
          [remainingTab]: terminal(remainingTab, sourcePane)
        },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: targetWorkspace,
        name: 'Target',
        description: null,
        color: null,
        workingDirectory: '/tmp',
        layout: { kind: 'leaf', paneId: targetPane },
        selectedPaneId: targetPane,
        panes: {
          [targetPane]: {
            id: targetPane,
            tabs: [targetTab],
            selectedTabId: targetTab,
            title: null
          }
        },
        tabs: { [targetTab]: terminal(targetTab, targetPane) },
        createdAt: 1,
        updatedAt: 1
      }
    ],
    selectedWorkspaceId: sourceWorkspace,
    workspaceSelection: [sourceWorkspace],
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
        id: sourceWindow,
        label: 'Source',
        workspaceIds: [sourceWorkspace],
        focusedWorkspaceId: sourceWorkspace,
        hostingState: 'hosted',
        revision: 2
      },
      {
        id: targetWindow,
        label: 'Target',
        workspaceIds: [targetWorkspace],
        focusedWorkspaceId: targetWorkspace,
        hostingState: 'hosted',
        revision: 3
      }
    ],
    focusedWindowId: sourceWindow,
    focusHistory: {
      entries: [
        {
          windowId: sourceWindow,
          workspaceId: sourceWorkspace,
          paneId: sourcePane,
          tabId: remainingTab
        },
        {
          windowId: sourceWindow,
          workspaceId: sourceWorkspace,
          paneId: sourcePane,
          tabId: movedTab
        },
        {
          windowId: targetWindow,
          workspaceId: targetWorkspace,
          paneId: targetPane,
          tabId: targetTab
        }
      ],
      cursor: 1
    }
  })
  const request = {
    mutation: { expectedRevision: 4, idempotencyEpoch: randomUUID(), idempotencyKey: randomUUID() },
    source: {
      windowId: sourceWindow,
      workspaceId: sourceWorkspace,
      paneId: sourcePane,
      tabId: movedTab,
      expectedWindowRevision: 2
    },
    target: {
      windowId: targetWindow,
      workspaceId: targetWorkspace,
      paneId: targetPane,
      destinationIndex: 1,
      expectedWindowRevision: 3
    }
  }
  return { state, request, remainingTab, targetTab }
}

it.each([
  { operation: 'move', targetMessage: 'Target workspace is not hosted' },
  { operation: 'duplicate', targetMessage: 'Target workspace is not hosted in its window' }
])('$operation validates exact window placements in order', ({ operation, targetMessage }) => {
  const { state, request } = twoWindowFixture()
  const { source, target } = request
  const wrongSource = { ...source, workspaceId: target.workspaceId }
  const wrongTarget = { ...target, workspaceId: source.workspaceId }
  const unhostedTarget = { ...state.windowPlacements[1]!, hostingState: 'unhosted' as const }
  const ids = { tabId: randomUUID(), browserSessionId: randomUUID() }

  const cases = [
    {
      placements: [],
      source,
      target,
      code: 'source_not_found',
      message: 'Source window is unavailable'
    },
    {
      placements: state.windowPlacements.slice(0, 1),
      source: { ...source, expectedWindowRevision: 1 },
      target,
      code: 'target_not_found',
      message: 'Target window is unavailable'
    },
    {
      placements: state.windowPlacements,
      source: { ...wrongSource, expectedWindowRevision: 1 },
      target,
      code: 'stale_window_revision',
      message: 'Window placement changed'
    },
    {
      placements: state.windowPlacements,
      source: wrongSource,
      target: { ...target, expectedWindowRevision: 2 },
      code: 'stale_window_revision',
      message: 'Window placement changed'
    },
    {
      placements: state.windowPlacements,
      source: wrongSource,
      target: wrongTarget,
      code: 'source_not_found',
      message: 'Source workspace is not in its window'
    },
    {
      placements: state.windowPlacements,
      source,
      target: wrongTarget,
      code: 'target_not_found',
      message: targetMessage
    },
    {
      placements: [state.windowPlacements[0]!, unhostedTarget],
      source,
      target,
      code: 'target_not_found',
      message: targetMessage
    }
  ]

  for (const entry of cases) {
    const input = { ...request, source: entry.source, target: entry.target }
    const initial = { ...state, windowPlacements: entry.placements }
    expect(() =>
      operation === 'move'
        ? moveExactTab(initial, input, 5)
        : duplicateTabExact(initial, input, ids, 5)
    ).toThrow(
      expect.objectContaining({
        name: 'WindowMutationError',
        code: entry.code,
        message: entry.message
      })
    )
  }
})

it('moves a live tab identity across windows while keeping a valid source workspace', () => {
  const { state, request, remainingTab, targetTab } = twoWindowFixture()
  const {
    windowId: sourceWindow,
    workspaceId: sourceWorkspace,
    paneId: sourcePane,
    tabId: movedTab
  } = request.source
  const {
    windowId: targetWindow,
    workspaceId: targetWorkspace,
    paneId: targetPane
  } = request.target
  const originalHistory = structuredClone(state.focusHistory)
  const moved = moveExactTab(state, request, 5)
  expect(moved.workspaces[0]?.panes[sourcePane]?.tabs).toEqual([remainingTab])
  expect(moved.workspaces[0]?.panes[sourcePane]?.selectedTabId).toBe(remainingTab)
  expect(moved.workspaces[1]?.panes[targetPane]?.tabs).toEqual([targetTab, movedTab])
  expect(moved.workspaces[1]?.tabs[movedTab]?.paneId).toBe(targetPane)
  expect(moved.workspaces[0]?.tabs[movedTab]).toBeUndefined()
  expect(moved.windowPlacements.map(({ revision }) => revision)).toEqual([3, 4])
  expect(moved.selectedWorkspaceId).toBe(targetWorkspace)
  expect(moved.focusHistory).toEqual({
    entries: [
      {
        windowId: sourceWindow,
        workspaceId: sourceWorkspace,
        paneId: sourcePane,
        tabId: remainingTab
      },
      { windowId: targetWindow, workspaceId: targetWorkspace, paneId: targetPane, tabId: movedTab }
    ],
    cursor: 1
  })
  expect(state.focusHistory).toEqual(originalHistory)
  expect(durableApplicationStateSchema.safeParse(moved).success).toBe(true)
  const reordered = moveExactTab(
    state,
    {
      ...request,
      target: {
        windowId: sourceWindow,
        workspaceId: sourceWorkspace,
        paneId: sourcePane,
        destinationIndex: 2,
        expectedWindowRevision: 2
      }
    },
    5
  )
  expect(reordered.workspaces[0]?.panes[sourcePane]?.tabs).toEqual([remainingTab, movedTab])
  expect(reordered.focusHistory).toEqual({
    entries: originalHistory.entries.slice(0, 2),
    cursor: 1
  })
  expect(state.focusHistory).toEqual(originalHistory)

  const fullEntries = Array.from({ length: 128 }, (_, index) =>
    index % 2 === 0 ? originalHistory.entries[0]! : originalHistory.entries[2]!
  )
  const movedWithFullHistory = moveExactTab(
    { ...state, focusHistory: { entries: fullEntries, cursor: 127 } },
    request,
    5
  )
  expect(movedWithFullHistory.focusHistory).toEqual({
    entries: [
      ...fullEntries.slice(1),
      { windowId: targetWindow, workspaceId: targetWorkspace, paneId: targetPane, tabId: movedTab }
    ],
    cursor: 127
  })

  for (const side of ['first', 'second'] as const) {
    const splitState = structuredClone(state)
    const source = splitState.workspaces[0]!
    const siblingPane = randomUUID()
    source.panes[sourcePane]!.tabs = [movedTab]
    source.panes[siblingPane] = {
      id: siblingPane,
      tabs: [remainingTab],
      selectedTabId: remainingTab,
      title: null
    }
    source.tabs[remainingTab]!.paneId = siblingPane
    splitState.focusHistory.entries[0]!.paneId = siblingPane
    const sibling = { kind: 'leaf', paneId: siblingPane }
    source.layout = {
      kind: 'split',
      splitId: randomUUID(),
      axis: 'vertical',
      ratio: 0.4,
      first: side === 'first' ? { kind: 'leaf', paneId: sourcePane } : sibling,
      second: side === 'second' ? { kind: 'leaf', paneId: sourcePane } : sibling
    }
    const result = moveExactTab(durableApplicationStateSchema.parse(splitState), request, 5)
    expect(result.workspaces[0]?.layout).toEqual(sibling)
    expect(result.workspaces[0]?.panes[sourcePane]).toBeUndefined()
    expect(result.workspaces[0]?.selectedPaneId).toBe(siblingPane)
    expect(result.workspaces[1]?.panes[targetPane]?.tabs).toEqual([targetTab, movedTab])
    expect(splitState.workspaces[0]?.panes[sourcePane]?.tabs).toEqual([movedTab])
  }

  const browserSessionId = randomUUID()
  const browserState = structuredClone(state)
  browserState.workspaces[0]!.tabs[movedTab]!.content = {
    kind: 'browser',
    metadata: {
      browserSessionId,
      url: 'https://example.test',
      profilePartition: 'persist:agent-workspace-default',
      stateRevision: 7
    }
  }
  const movedBrowser = moveExactTab(browserState, request, 5)
  expect(movedBrowser.workspaces[0]?.tabs[movedTab]).toBeUndefined()
  expect(movedBrowser.workspaces[1]?.tabs[movedTab]?.content).toEqual({
    kind: 'browser',
    metadata: {
      browserSessionId,
      url: 'https://example.test',
      profilePartition: 'persist:agent-workspace-default',
      stateRevision: 7
    }
  })
  delete browserState.workspaces[0]!.tabs[movedTab]!.content.metadata.browserSessionId
  expect(() => moveExactTab(browserState, request, 5)).toThrow(
    'Tab has no transferable runtime identity'
  )
})
