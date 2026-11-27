import { randomUUID } from 'node:crypto'
import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { expect, it } from 'vitest'

import { detachExactTab } from './advanced-tab-detach'

it('atomically detaches a final browser tab and replaces its source with a terminal', () => {
  const ids = {
    sourceWindow: randomUUID(),
    sourceWorkspace: randomUUID(),
    sourcePane: randomUUID(),
    tabId: randomUUID(),
    browserSessionId: randomUUID(),
    windowId: randomUUID(),
    workspaceId: randomUUID(),
    paneId: randomUUID(),
    replacementTabId: randomUUID()
  }
  const state = durableApplicationStateSchema.parse({
    revision: 4,
    workspaces: [
      {
        id: ids.sourceWorkspace,
        name: 'Source',
        description: null,
        color: null,
        workingDirectory: '/tmp',
        layout: { kind: 'leaf', paneId: ids.sourcePane },
        selectedPaneId: ids.sourcePane,
        panes: {
          [ids.sourcePane]: {
            id: ids.sourcePane,
            tabs: [ids.tabId],
            selectedTabId: ids.tabId,
            title: null
          }
        },
        tabs: {
          [ids.tabId]: {
            id: ids.tabId,
            paneId: ids.sourcePane,
            title: 'Browser',
            customTitle: null,
            content: {
              kind: 'browser',
              metadata: {
                browserSessionId: ids.browserSessionId,
                url: 'https://example.test'
              }
            },
            createdAt: 1
          }
        },
        createdAt: 1,
        updatedAt: 1
      }
    ],
    selectedWorkspaceId: ids.sourceWorkspace,
    workspaceSelection: [ids.sourceWorkspace],
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
        id: ids.sourceWindow,
        label: 'Source',
        workspaceIds: [ids.sourceWorkspace],
        focusedWorkspaceId: ids.sourceWorkspace,
        hostingState: 'hosted',
        revision: 2
      }
    ],
    focusedWindowId: ids.sourceWindow,
    focusHistory: {
      entries: [
        {
          windowId: ids.sourceWindow,
          workspaceId: ids.sourceWorkspace,
          paneId: ids.sourcePane,
          tabId: ids.tabId
        }
      ],
      cursor: 0
    }
  })
  const request = {
    mutation: { expectedRevision: 4, idempotencyEpoch: randomUUID(), idempotencyKey: randomUUID() },
    source: {
      windowId: ids.sourceWindow,
      workspaceId: ids.sourceWorkspace,
      paneId: ids.sourcePane,
      tabId: ids.tabId,
      expectedWindowRevision: 2
    },
    windowLabel: 'Detached browser'
  }
  const detached = detachExactTab(state, request, ids, 5)
  expect(detached.revision).toBe(5)
  expect(detached.workspaces[0]?.tabs[ids.tabId]).toBeUndefined()
  expect(detached.workspaces[0]?.tabs[ids.replacementTabId]?.content.kind).toBe('terminal')
  expect(detached.workspaces[1]?.tabs[ids.tabId]?.content).toEqual({
    kind: 'browser',
    metadata: {
      browserSessionId: ids.browserSessionId,
      url: 'https://example.test'
    }
  })
  expect(detached.workspaces[1]?.tabs[ids.tabId]?.paneId).toBe(ids.paneId)
  expect(detached.windowPlacements[0]?.revision).toBe(3)
  expect(detached.windowPlacements[1]).toMatchObject({
    id: ids.windowId,
    hostingState: 'unhosted',
    workspaceIds: [ids.workspaceId]
  })
  expect(detached.focusHistory.entries.at(-1)?.tabId).toBe(ids.tabId)
  expect(() =>
    detachExactTab(
      state,
      {
        ...request,
        source: { ...request.source, expectedWindowRevision: 1 }
      },
      ids,
      5
    )
  ).toThrow('Window placement changed')
  expect(state.workspaces).toHaveLength(1)

  for (const side of ['first', 'second'] as const) {
    const splitState = structuredClone(state)
    const source = splitState.workspaces[0]!
    const siblingPane = randomUUID()
    const siblingTab = randomUUID()
    source.panes[siblingPane] = {
      id: siblingPane,
      tabs: [siblingTab],
      selectedTabId: siblingTab,
      title: null
    }
    source.tabs[siblingTab] = {
      ...source.tabs[ids.tabId]!,
      id: siblingTab,
      paneId: siblingPane,
      content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } }
    }
    const otherTab = randomUUID()
    source.panes[siblingPane].tabs.push(otherTab)
    source.tabs[otherTab] = { ...source.tabs[siblingTab], id: otherTab }
    const sibling = { kind: 'leaf', paneId: siblingPane }
    source.layout = {
      kind: 'split',
      splitId: randomUUID(),
      axis: 'horizontal',
      ratio: 0.6,
      first: side === 'first' ? { kind: 'leaf', paneId: ids.sourcePane } : sibling,
      second: side === 'second' ? { kind: 'leaf', paneId: ids.sourcePane } : sibling
    }
    const movingFocus = splitState.focusHistory.entries[0]!
    const siblingFocus = { ...movingFocus, paneId: siblingPane, tabId: siblingTab }
    const otherFocus = { ...siblingFocus, tabId: otherTab }
    const detachedFocus = {
      windowId: ids.windowId,
      workspaceId: ids.workspaceId,
      paneId: ids.paneId,
      tabId: ids.tabId
    }
    splitState.focusHistory = {
      entries: [movingFocus, siblingFocus, movingFocus, otherFocus, movingFocus],
      cursor: 2
    }
    const input = durableApplicationStateSchema.parse(splitState)
    const original = structuredClone(input)
    const result = detachExactTab(input, request, ids, 5)
    expect(result.workspaces[0]?.layout).toEqual(sibling)
    expect(result.workspaces[0]?.panes[ids.sourcePane]).toBeUndefined()
    expect(result.workspaces[0]?.selectedPaneId).toBe(siblingPane)
    expect(result.workspaces[0]?.tabs[ids.replacementTabId]).toBeUndefined()
    expect(result.workspaces[1]?.tabs[ids.tabId]?.content).toEqual(source.tabs[ids.tabId]?.content)
    expect(result.focusHistory).toEqual({ entries: [siblingFocus, detachedFocus], cursor: 1 })
    expect(input).toEqual(original)

    splitState.focusHistory = { entries: [movingFocus, siblingFocus, otherFocus], cursor: 0 }
    const clamped = detachExactTab(durableApplicationStateSchema.parse(splitState), request, ids, 5)
    expect(clamped.focusHistory).toEqual({ entries: [siblingFocus, detachedFocus], cursor: 1 })

    const fullHistory = Array.from({ length: 128 }, (_, index) =>
      index % 2 === 0 ? siblingFocus : otherFocus
    )
    splitState.focusHistory = { entries: fullHistory, cursor: 127 }
    const capped = detachExactTab(durableApplicationStateSchema.parse(splitState), request, ids, 5)
    expect(capped.focusHistory).toEqual({
      entries: [...fullHistory.slice(1), detachedFocus],
      cursor: 127
    })
  }

  const terminalState = structuredClone(state)
  terminalState.workspaces[0]!.tabs[ids.tabId]!.content = {
    kind: 'terminal',
    launch: { cwd: '/tmp', rows: 30, cols: 100 }
  }
  const detachedTerminal = detachExactTab(terminalState, request, ids, 5)
  expect(detachedTerminal.workspaces[1]?.tabs[ids.tabId]?.content).toEqual({
    kind: 'terminal',
    launch: { cwd: '/tmp', rows: 30, cols: 100 }
  })

  const source = terminalState.workspaces[0]!
  const sourcePane = source.panes[ids.sourcePane]!
  const firstTab = randomUUID()
  const previousTab = randomUUID()
  for (const id of [firstTab, previousTab]) {
    source.tabs[id] = { ...source.tabs[ids.tabId]!, id }
  }
  sourcePane.tabs = [firstTab, previousTab, ids.tabId]

  const selectedLast = detachExactTab(
    durableApplicationStateSchema.parse(terminalState),
    request,
    ids,
    5
  )
  expect(selectedLast.workspaces[0]?.panes[ids.sourcePane]).toMatchObject({
    tabs: [firstTab, previousTab],
    selectedTabId: previousTab
  })

  sourcePane.selectedTabId = firstTab
  const unselectedLast = detachExactTab(
    durableApplicationStateSchema.parse(terminalState),
    request,
    ids,
    5
  )
  expect(unselectedLast.workspaces[0]?.panes[ids.sourcePane]).toMatchObject({
    tabs: [firstTab, previousTab],
    selectedTabId: firstTab
  })
})
