import { randomUUID } from 'node:crypto'
import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { describe, expect, it } from 'vitest'
import {
  closeWindowPlacement,
  closeWindowWorkspaces,
  createWindowPlacement,
  focusWindowPlacement,
  validFocus,
  WindowMutationError
} from './window-mutations'
import { projectStateToWindow } from './window-projection'
import { projectApplicationSnapshot } from './application-projection'
import { projectOrganization } from './organization-mutations'
import { reopenClosedTab } from './recently-closed-mutations'
import {
  closePane,
  closeTab,
  collapsePane,
  focusPane,
  moveTab,
  openBrowserTab,
  splitPane,
  WorkspaceMutationError,
  type PaneLayout
} from './workspace-mutations'
import { navigateBrowser, BrowserMutationError } from './browser-mutations'

function fixture() {
  const windowId = randomUUID()
  const workspaces = [randomUUID(), randomUUID()]
  const panes = workspaces.map(() => randomUUID())
  const tabs = workspaces.map(() => randomUUID())
  const state = durableApplicationStateSchema.parse({
    revision: 1,
    workspaces: workspaces.map((id, index) => ({
      id,
      name: `Workspace ${index + 1}`,
      description: null,
      color: null,
      workingDirectory: '/tmp',
      layout: { kind: 'leaf', paneId: panes[index] },
      selectedPaneId: panes[index],
      panes: {
        [panes[index]!]: {
          id: panes[index],
          tabs: [tabs[index]],
          selectedTabId: tabs[index],
          title: null
        }
      },
      tabs: {
        [tabs[index]!]: {
          id: tabs[index],
          paneId: panes[index],
          title: 'Terminal',
          customTitle: null,
          content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } },
          createdAt: 1
        }
      },
      createdAt: 1,
      updatedAt: 1
    })),
    selectedWorkspaceId: workspaces[0],
    workspaceSelection: [workspaces[0]],
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
        workspaceIds: workspaces,
        focusedWorkspaceId: workspaces[0],
        hostingState: 'hosted',
        revision: 1
      }
    ],
    focusedWindowId: windowId,
    focusHistory: { entries: [], cursor: 0 }
  })
  return { state, windowId, workspaces }
}

it('projects the latest unread body at each attention level with a 160-code-point limit', () => {
  const { state } = fixture()
  const workspace = state.workspaces[0]!
  const pane = workspace.panes[workspace.selectedPaneId]!
  const notification = {
    id: randomUUID(),
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: pane.selectedTabId,
    source: 'internal',
    level: 'error',
    title: 'Terminal notification',
    body: null,
    createdAt: 1,
    readAt: null
  } as const
  state.notifications.push(notification)
  expect(projectApplicationSnapshot(state).attention.latestUnread?.bodyExcerpt).toBeNull()

  const bodyExcerpt = `a\u2028${'b'.repeat(157)}😀`
  const latest = {
    ...notification,
    id: randomUUID(),
    level: 'info',
    body: `${bodyExcerpt} omitted`,
    createdAt: 2
  } as const
  state.notifications.push(latest)
  const snapshot = projectApplicationSnapshot(durableApplicationStateSchema.parse(state))
  const projectedWorkspace = snapshot.workspaces[0]!
  const expectedAttention = {
    unreadCount: 2,
    highestLevel: 'error',
    latestUnread: {
      notificationId: latest.id,
      title: latest.title,
      bodyExcerpt,
      source: latest.source,
      createdAt: latest.createdAt
    }
  }
  for (const { attention } of [
    snapshot,
    projectedWorkspace,
    projectedWorkspace.panes[0]!,
    projectedWorkspace.tabs[0]!
  ]) {
    expect(attention).toEqual(expectedAttention)
  }

  const boundaryPrefix = 'a'.repeat(159)
  state.notifications[1] = { ...latest, body: `${boundaryPrefix} omitted` }
  const boundarySnapshot = projectApplicationSnapshot(durableApplicationStateSchema.parse(state))
  expect(boundarySnapshot.attention.latestUnread?.bodyExcerpt).toBe(boundaryPrefix)

  state.notifications[1] = { ...latest, body: '' }
  expect(() => projectApplicationSnapshot(state)).toThrow('text must be normalized')
})

it('selects the final unread excerpt independently at each attention scope', () => {
  const { state } = fixture()
  const workspace = state.workspaces[0]!
  const pane = workspace.panes[workspace.selectedPaneId]!
  const id = (suffix: number) => `00000000-0000-4000-8000-00000000000${suffix}`
  const tabWinner = {
    id: id(2),
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: pane.selectedTabId,
    source: 'osc',
    level: 'info',
    title: 'Tab notification',
    body: 'Tab body',
    createdAt: 2,
    readAt: null
  } as const
  const paneWinner = {
    ...tabWinner,
    id: id(3),
    tabId: null,
    title: 'Pane notification',
    body: null,
    createdAt: 3
  } as const
  const workspaceWinner = {
    ...paneWinner,
    id: id(4),
    paneId: null,
    level: 'error',
    title: 'Workspace notification',
    body: 'Workspace body',
    createdAt: 4
  } as const
  const applicationWinner = {
    ...tabWinner,
    id: id(5),
    tabId: id(9),
    title: 'Orphaned tab notification',
    body: 'Application body',
    createdAt: 5
  } as const
  state.notifications.push(
    paneWinner,
    { ...tabWinner, id: id(1), title: 'First lower ID at the same time' },
    tabWinner,
    applicationWinner,
    { ...tabWinner, id: id(0), title: 'Last lower ID at the same time' },
    { ...tabWinner, id: id(6), level: 'warning', createdAt: 1 },
    { ...tabWinner, id: id(7), level: 'error', createdAt: 6, readAt: 7 },
    workspaceWinner
  )

  const snapshot = projectApplicationSnapshot(durableApplicationStateSchema.parse(state))
  const projectedWorkspace = snapshot.workspaces[0]!
  for (const [attention, winner, unreadCount, highestLevel] of [
    [snapshot.attention, applicationWinner, 7, 'error'],
    [projectedWorkspace.attention, workspaceWinner, 6, 'error'],
    [projectedWorkspace.panes[0]!.attention, paneWinner, 5, 'warning'],
    [projectedWorkspace.tabs[0]!.attention, tabWinner, 4, 'warning']
  ] as const) {
    expect(attention).toEqual({
      unreadCount,
      highestLevel,
      latestUnread: {
        notificationId: winner.id,
        title: winner.title,
        bodyExcerpt: winner.body,
        source: winner.source,
        createdAt: winner.createdAt
      }
    })
  }
})

it('checks every focus target membership without changing the state', () => {
  const { state, windowId } = fixture()
  const workspace = state.workspaces[0]!
  const pane = workspace.panes[workspace.selectedPaneId]!
  const target = {
    windowId,
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: pane.selectedTabId
  }
  const before = structuredClone(state)
  expect(validFocus(state, target)).toBe(true)
  for (const key of ['windowId', 'workspaceId', 'paneId', 'tabId'] as const) {
    expect(validFocus(state, { ...target, [key]: randomUUID() })).toBe(false)
  }
  const other = state.workspaces[1]!
  expect(validFocus(state, { ...target, workspaceId: other.id })).toBe(false)
  expect(state).toEqual(before)
  state.windowPlacements[0]!.workspaceIds = [other.id]
  expect(validFocus(state, target)).toBe(false)
})

it.each([
  {
    boundary: 'supplementary code point',
    prefix: 'a'.repeat(159),
    suffix: '😀 omitted',
    expectedSuffix: '😀'
  },
  { boundary: 'space', prefix: 'a'.repeat(159), suffix: ' omitted', expectedSuffix: '' },
  {
    boundary: 'sidebar label limit',
    prefix: `${'😀'.repeat(127)}a`,
    suffix: '😀'.repeat(34),
    expectedSuffix: ''
  }
])(
  'closes a tab with a long custom title cut at the $boundary',
  ({ prefix, suffix, expectedSuffix }) => {
    const { state } = fixture()
    const workspace = state.workspaces[0]!
    const pane = workspace.panes[workspace.selectedPaneId]!
    const tabId = pane.selectedTabId
    workspace.tabs[tabId]!.customTitle = `${prefix}${suffix}`
    const closedId = randomUUID()
    const replacementId = randomUUID()

    const closed = closeTab(
      durableApplicationStateSchema.parse(state),
      workspace.id,
      tabId,
      closedId,
      replacementId,
      2
    )

    expect(closed.workspaces[0]!.tabs[tabId]).toBeUndefined()
    expect(closed.workspaces[0]!.panes[pane.id]!.tabs).toEqual([replacementId])
    expect(closed.recentlyClosed).toMatchObject([
      {
        id: closedId,
        itemKind: 'tab',
        priorWorkspaceId: workspace.id,
        priorTabId: tabId,
        contentKind: 'terminal',
        title: `${prefix}${expectedSuffix}`
      }
    ])
  }
)

it.each([
  { history: 'a middle cursor', hasHistory: true },
  { history: 'empty history', hasHistory: false }
])('records restored tab focus with $history', ({ hasHistory }) => {
  const { state, windowId } = fixture()
  const workspace = state.workspaces[0]!
  const other = state.workspaces[1]!
  const tabId = workspace.panes[workspace.selectedPaneId]!.selectedTabId
  const closedId = randomUUID()
  const replacementId = randomUUID()
  const closed = closeTab(state, workspace.id, tabId, closedId, replacementId, 2)
  const previousFocus = {
    windowId,
    workspaceId: workspace.id,
    paneId: workspace.selectedPaneId,
    tabId: replacementId
  }
  const otherFocus = {
    windowId,
    workspaceId: other.id,
    paneId: other.selectedPaneId,
    tabId: other.panes[other.selectedPaneId]!.selectedTabId
  }
  closed.focusHistory = hasHistory
    ? { entries: [otherFocus, previousFocus, otherFocus], cursor: 1 }
    : { entries: [], cursor: 0 }
  const before = structuredClone(closed)
  const restoredId = randomUUID()
  const restored = reopenClosedTab(
    closed,
    closedId,
    {
      windowId,
      workspaceId: workspace.id,
      paneId: workspace.selectedPaneId,
      destinationIndex: 1,
      expectedWindowRevision: closed.windowPlacements[0]!.revision
    },
    restoredId,
    randomUUID(),
    3
  )
  const focus = { ...previousFocus, tabId: restoredId }
  expect(restored.focusHistory).toEqual(
    hasHistory
      ? { entries: [otherFocus, previousFocus, focus], cursor: 2 }
      : { entries: [previousFocus, focus], cursor: 1 }
  )
  expect(restored.workspaces[0]!.tabs[restoredId]!.content).toEqual(workspace.tabs[tabId]!.content)
  expect(restored.recentlyClosed).toEqual([])
  expect(closed).toEqual(before)
})

it('moves one workspace, fences revisions, focuses only hosted windows, and rehomes on close', () => {
  const { state, windowId, workspaces } = fixture()
  const secondWindow = randomUUID()
  const created = createWindowPlacement(state, {
    sourceWindowId: windowId,
    sourceRevision: 1,
    workspaceId: workspaces[1]!,
    windowId: secondWindow,
    label: 'Second'
  })
  expect(created.windowPlacements).toHaveLength(2)
  expect(created.windowPlacements[0]).toMatchObject({
    workspaceIds: [workspaces[0]],
    revision: 2
  })
  expect(created.windowPlacements[1]).toMatchObject({
    workspaceIds: [workspaces[1]],
    hostingState: 'unhosted'
  })
  const scoped = projectStateToWindow(created, secondWindow)!
  expect(scoped.workspaces.map(({ id }) => id)).toEqual([workspaces[1]])
  expect(scoped.selectedWorkspaceId).toBe(workspaces[1])
  expect(projectApplicationSnapshot(scoped).workspaces.map(({ id }) => id)).toEqual([workspaces[1]])
  expect(projectOrganization(scoped).organization.selection).toEqual([workspaces[1]])
  expect(() =>
    focusWindowPlacement(created, { windowId: secondWindow, expectedRevision: 0 })
  ).toThrow(WindowMutationError)
  const hosted = structuredClone(created)
  hosted.windowPlacements[1]!.hostingState = 'hosted'
  hosted.windowPlacements[1]!.revision = 1
  const focused = focusWindowPlacement(hosted, { windowId, expectedRevision: 2 })
  expect(focused.focusedWindowId).toBe(windowId)
  expect(focused.selectedWorkspaceId).toBe(workspaces[0])
  const secondaryRead = projectStateToWindow(focused, secondWindow)!
  expect(projectApplicationSnapshot(secondaryRead)).toMatchObject({
    selectedWorkspaceId: workspaces[1],
    workspaces: [{ id: workspaces[1] }]
  })
  expect(projectOrganization(secondaryRead).organization.focusedWorkspaceId).toBe(workspaces[1])
  expect(() =>
    closeWindowPlacement(focused, {
      windowId: secondWindow,
      expectedRevision: 0,
      targetWindowId: windowId,
      targetRevision: 2
    })
  ).toThrow(WindowMutationError)
  const closed = closeWindowPlacement(focused, {
    windowId: secondWindow,
    expectedRevision: 1,
    targetWindowId: windowId,
    targetRevision: 2
  })
  expect(closed.windowPlacements).toHaveLength(1)
  expect(closed.windowPlacements[0]).toMatchObject({
    workspaceIds: [workspaces[0], workspaces[1]],
    revision: 3
  })
  expect(closed.focusHistory.entries.every((entry) => entry.windowId === windowId)).toBe(true)
  expect(durableApplicationStateSchema.safeParse(closed).success).toBe(true)
})

it('projects only owned workspaces and records and detaches retained data', () => {
  const { state, windowId, workspaces } = fixture()
  const secondWindow = randomUUID()
  let twoWindows = createWindowPlacement(state, {
    sourceWindowId: windowId,
    sourceRevision: 1,
    workspaceId: workspaces[1]!,
    windowId: secondWindow,
    label: 'Second'
  })
  for (const workspace of twoWindows.workspaces) {
    const pane = workspace.panes[workspace.selectedPaneId]!
    twoWindows = closeTab(
      twoWindows,
      workspace.id,
      pane.selectedTabId,
      randomUUID(),
      randomUUID(),
      2
    )
  }
  twoWindows.notifications = twoWindows.workspaces.map((workspace) => ({
    id: randomUUID(),
    workspaceId: workspace.id,
    paneId: workspace.selectedPaneId,
    tabId: workspace.panes[workspace.selectedPaneId]!.selectedTabId,
    source: 'internal',
    level: 'info',
    title: 'Terminal notification',
    body: null,
    createdAt: 3,
    readAt: null
  }))
  const input = durableApplicationStateSchema.parse(twoWindows)
  const before = structuredClone(input)
  const projected = projectStateToWindow(input, secondWindow)!
  const workspace = projected.workspaces[0]!
  const ownedClosed = before.recentlyClosed.find((item) => item.priorWorkspaceId === workspaces[1])!

  expect(projected.workspaces).toEqual([before.workspaces[1]])
  expect(projected.windowPlacements).toEqual([before.windowPlacements[1]])
  expect(projected.notifications).toEqual([before.notifications[1]])
  expect(projected.recentlyClosed).toEqual([ownedClosed])

  workspace.tabs[workspace.panes[workspace.selectedPaneId]!.selectedTabId]!.title = 'Changed tab'
  projected.windowPlacements[0]!.workspaceIds.push(workspaces[0]!)
  projected.notifications[0]!.title = 'Changed notification'
  projected.recentlyClosed[0]!.title = 'Changed closed item'
  expect(input).toEqual(before)
})

it('atomically closes a nonfinal window with Rust-parity records and survivor focus', () => {
  const { state, windowId, workspaces } = fixture()
  const secondId = randomUUID()
  const moved = createWindowPlacement(state, {
    sourceWindowId: windowId,
    sourceRevision: 1,
    workspaceId: workspaces[1]!,
    windowId: secondId,
    label: 'Second'
  })
  const itemId = randomUUID()
  const closed = closeWindowWorkspaces(moved, {
    windowId: secondId,
    expectedRevision: 0,
    closedItemIds: [itemId],
    now: 2
  })
  expect(closed.revision).toBe(moved.revision + 1)
  expect(closed.windowPlacements.map((item) => item.id)).toEqual([windowId])
  expect(closed.workspaces.map((item) => item.id)).toEqual([workspaces[0]])
  expect(closed.focusedWindowId).toBe(windowId)
  expect(closed.recentlyClosed).toMatchObject([
    {
      id: itemId,
      priorWorkspaceId: workspaces[1],
      itemKind: 'tab',
      restore: { kind: 'terminal', authorized_root_id: workspaces[1] }
    }
  ])
  // Rust records the removed workspace as the terminal authorization root.
  // Reopen must reject that stale root, even through a surviving window.
  const survivor = closed.workspaces[0]!
  const survivorPane = survivor.panes[survivor.selectedPaneId]!
  expect(() =>
    reopenClosedTab(
      closed,
      itemId,
      {
        windowId,
        expectedWindowRevision: closed.windowPlacements[0]!.revision,
        workspaceId: survivor.id,
        paneId: survivorPane.id,
        destinationIndex: 0
      },
      randomUUID(),
      randomUUID(),
      3
    )
  ).toThrowError('policy denied')
  expect(() =>
    closeWindowWorkspaces(moved, {
      windowId: secondId,
      expectedRevision: 1,
      closedItemIds: [randomUUID()],
      now: 2
    })
  ).toThrow(WindowMutationError)
  expect(() =>
    closeWindowWorkspaces(state, {
      windowId,
      expectedRevision: 1,
      closedItemIds: [randomUUID(), randomUUID()],
      now: 2
    })
  ).toThrow(WindowMutationError)
})

describe.each(['tab', 'window'] as const)('recently closed retention on %s close', (target) => {
  const retentionMs = 30 * 24 * 60 * 60 * 1_000
  const now = retentionMs + 2
  const oldId = '00000000-0000-4000-8000-000000000001'
  const boundaryId = '00000000-0000-4000-8000-000000000002'
  const futureId = '00000000-0000-4000-8000-000000000003'
  const beforeTieId = '00000000-0000-4000-8000-00000000000a'
  const closedId = '00000000-0000-4000-8000-00000000000b'
  const afterTieId = '00000000-0000-4000-8000-00000000000c'
  const fullHistory = Array.from({ length: 100 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(index + 256).toString(16).padStart(12, '0')}`,
    closedAt: now - 100 + index
  }))

  it.each([
    {
      name: 'keeps the age boundary and future records and orders timestamp ties by ID',
      history: [
        { id: oldId, closedAt: now - retentionMs - 1 },
        { id: boundaryId, closedAt: now - retentionMs },
        { id: beforeTieId, closedAt: now },
        { id: afterTieId, closedAt: now },
        { id: futureId, closedAt: now + 1 }
      ],
      expectedIds: [boundaryId, beforeTieId, closedId, afterTieId, futureId]
    },
    {
      name: 'drops the oldest record when the new record exceeds the 100-item cap',
      history: fullHistory,
      expectedIds: [...fullHistory.slice(1).map(({ id }) => id), closedId]
    }
  ])('$name', ({ history, expectedIds }) => {
    const { state, windowId } = fixture()
    const workspace = state.workspaces[1]!
    const tabId = workspace.panes[workspace.selectedPaneId]!.selectedTabId
    state.recentlyClosed = history.map(({ id, closedAt }) => ({
      id,
      itemKind: 'tab',
      priorWorkspaceId: workspace.id,
      priorTabId: tabId,
      contentKind: 'terminal',
      title: 'Terminal',
      closedAt,
      restore: {
        kind: 'terminal',
        authorized_root_id: workspace.id,
        root_relative_cwd: '',
        rows: 24,
        cols: 80
      }
    }))

    const secondId = randomUUID()
    const input =
      target === 'tab'
        ? durableApplicationStateSchema.parse(state)
        : createWindowPlacement(state, {
            sourceWindowId: windowId,
            sourceRevision: 1,
            workspaceId: workspace.id,
            windowId: secondId,
            label: 'Second'
          })
    const before = structuredClone(input)
    const closed =
      target === 'tab'
        ? closeTab(input, workspace.id, tabId, closedId, randomUUID(), now)
        : closeWindowWorkspaces(input, {
            windowId: secondId,
            expectedRevision: 0,
            closedItemIds: [closedId],
            now
          })
    expect(closed.recentlyClosed.map(({ id }) => id)).toEqual(expectedIds)
    expect(input).toEqual(before)
  })
})

it.each([
  { partition: {}, expectedPartition: 'persist:agent-workspace-default' },
  { partition: { profilePartition: 'persist:custom' }, expectedPartition: 'persist:custom' }
])('opens and splits browser tabs in $expectedPartition', ({ partition, expectedPartition }) => {
  const { state } = fixture()
  const { id: workspaceId, selectedPaneId: paneId } = state.workspaces[0]!
  const tabId = randomUUID()
  const browserSessionId = randomUUID()
  const url = 'https://example.com/'
  const expected = {
    kind: 'browser',
    metadata: {
      browserSessionId,
      url,
      navigationTitle: '',
      canBack: false,
      canForward: false,
      loading: false,
      devToolsOpen: false,
      profilePartition: expectedPartition,
      stateRevision: 0,
      correlationId: null
    }
  }

  const opened = openBrowserTab(
    state,
    { workspaceId, paneId, metadata: { url }, ...partition },
    tabId,
    browserSessionId,
    2
  )
  const split = splitPane(
    state,
    {
      workspaceId,
      targetPaneId: paneId,
      axis: 'horizontal',
      ratio: 0.5,
      placement: 'after',
      content: { kind: 'newBrowser', url, ...partition }
    },
    { paneId: randomUUID(), splitId: randomUUID(), tabId, browserSessionId },
    2
  )

  expect(opened.workspaces[0]!.tabs[tabId]!.content).toStrictEqual(expected)
  expect(split.workspaces[0]!.tabs[tabId]!.content).toStrictEqual(expected)
})

it.each([
  { source: 'with a remaining tab', keepSource: true },
  { source: 'with only the moved tab', keepSource: false }
])('splits an existing selected tab from a source pane $source', ({ keepSource }) => {
  const { state, windowId } = fixture()
  const { id: workspaceId, selectedPaneId: targetPaneId, panes } = state.workspaces[0]!
  const source = {
    paneId: randomUUID(),
    splitId: randomUUID(),
    tabId: randomUUID(),
    browserSessionId: randomUUID()
  }
  const split = splitPane(
    state,
    {
      workspaceId,
      targetPaneId,
      axis: 'horizontal',
      ratio: 0.5,
      placement: 'after',
      content: { kind: 'newTerminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } }
    },
    source,
    2
  )
  const tabId = keepSource ? randomUUID() : source.tabId
  const input = keepSource
    ? openBrowserTab(
        split,
        { workspaceId, paneId: source.paneId, metadata: { url: 'https://example.com/' } },
        tabId,
        randomUUID(),
        3
      )
    : split
  const before = structuredClone(input)
  expect(before.workspaces[0]!.selectedPaneId).toBe(source.paneId)
  expect(before.workspaces[0]!.panes[source.paneId]!.selectedTabId).toBe(tabId)
  const destination = {
    paneId: randomUUID(),
    splitId: randomUUID(),
    tabId: randomUUID(),
    browserSessionId: randomUUID()
  }

  const next = splitPane(
    input,
    {
      workspaceId,
      targetPaneId,
      axis: 'vertical',
      ratio: 0.6,
      placement: 'before',
      content: { kind: 'existingTab', tabId }
    },
    destination,
    4
  )

  const workspace = next.workspaces[0]!
  const newSplit = {
    kind: 'split',
    splitId: destination.splitId,
    axis: 'vertical',
    ratio: 0.6,
    first: { kind: 'leaf', paneId: destination.paneId },
    second: { kind: 'leaf', paneId: targetPaneId }
  }
  expect(workspace.layout).toEqual(
    keepSource
      ? {
          kind: 'split',
          splitId: source.splitId,
          axis: 'horizontal',
          ratio: 0.5,
          first: newSplit,
          second: { kind: 'leaf', paneId: source.paneId }
        }
      : newSplit
  )
  expect(workspace.panes[targetPaneId]).toEqual(panes[targetPaneId])
  expect(workspace.panes[source.paneId]).toEqual(
    keepSource
      ? { id: source.paneId, tabs: [source.tabId], selectedTabId: source.tabId, title: null }
      : undefined
  )
  expect(workspace.panes[destination.paneId]).toMatchObject({
    tabs: [tabId],
    selectedTabId: tabId
  })
  expect(workspace.tabs[tabId]).toEqual({
    ...before.workspaces[0]!.tabs[tabId],
    paneId: destination.paneId
  })
  expect(workspace.selectedPaneId).toBe(destination.paneId)
  expect(next.focusHistory.entries[next.focusHistory.cursor]).toEqual({
    windowId,
    workspaceId,
    paneId: destination.paneId,
    tabId
  })
  expect(next.focusHistory.entries).not.toContainEqual({
    windowId,
    workspaceId,
    paneId: source.paneId,
    tabId
  })
  expect(input).toEqual(before)
})

it.each([
  { operation: 'closeTab', focus: 'selected' },
  { operation: 'closePane', focus: 'selected' },
  { operation: 'closeTab', focus: 'background' },
  { operation: 'closePane', focus: 'background' }
])('$operation collapses a $focus pane and reconciles focus', ({ operation, focus }) => {
  const { state, windowId } = fixture()
  const { id: workspaceId, selectedPaneId: paneA, panes } = state.workspaces[0]!
  const paneB = {
    paneId: randomUUID(),
    splitId: randomUUID(),
    tabId: randomUUID(),
    browserSessionId: randomUUID()
  }
  const paneC = {
    paneId: randomUUID(),
    splitId: randomUUID(),
    tabId: randomUUID(),
    browserSessionId: randomUUID()
  }
  const split = {
    workspaceId,
    targetPaneId: paneA,
    axis: 'horizontal',
    ratio: 0.5,
    content: { kind: 'newTerminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } }
  } as const
  const withB = splitPane(state, { ...split, placement: 'before' }, paneB, 2)
  const withC = splitPane(withB, { ...split, placement: 'after' }, paneC, 3)
  expect(withC.workspaces[0]!.selectedPaneId).toBe(paneC.paneId)
  const input = focus === 'selected' ? withC : focusPane(withC, workspaceId, paneA, 4)
  const before = structuredClone(input)

  const closed =
    operation === 'closeTab'
      ? closeTab(input, workspaceId, paneC.tabId, randomUUID(), null, 5)
      : closePane(input, workspaceId, paneC.paneId, null, 5)

  const workspace = closed.workspaces[0]!
  expect(workspace.layout).toEqual({
    kind: 'split',
    splitId: paneB.splitId,
    axis: 'horizontal',
    ratio: 0.5,
    first: { kind: 'leaf', paneId: paneB.paneId },
    second: { kind: 'leaf', paneId: paneA }
  })
  expect(Object.keys(workspace.panes)).toEqual([paneA, paneB.paneId])
  expect(workspace.tabs[paneC.tabId]).toBeUndefined()
  const selectedPaneId = focus === 'selected' ? paneB.paneId : paneA
  expect(workspace.selectedPaneId).toBe(selectedPaneId)
  expect(closed.focusHistory.entries[closed.focusHistory.cursor]).toEqual({
    windowId,
    workspaceId,
    paneId: selectedPaneId,
    tabId: focus === 'selected' ? paneB.tabId : panes[paneA]!.selectedTabId
  })
  expect(input).toEqual(before)
})

it('selects the adjacent source tab and collapses the split when moving the last source tab', () => {
  const { state } = fixture()
  const { id: workspaceId, selectedPaneId: sourcePaneId, panes } = state.workspaces[0]!
  const terminalTabId = panes[sourcePaneId]!.selectedTabId
  const destinationPaneId = randomUUID()
  const destinationTabId = randomUUID()
  const browserTabId = randomUUID()
  const split = splitPane(
    state,
    {
      workspaceId,
      targetPaneId: sourcePaneId,
      axis: 'horizontal',
      ratio: 0.5,
      placement: 'after',
      content: { kind: 'newTerminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } }
    },
    {
      paneId: destinationPaneId,
      splitId: randomUUID(),
      tabId: destinationTabId,
      browserSessionId: randomUUID()
    },
    2
  )
  const opened = openBrowserTab(
    split,
    {
      workspaceId,
      paneId: sourcePaneId,
      destinationIndex: 0,
      metadata: { url: 'https://example.com/' }
    },
    browserTabId,
    randomUUID(),
    3
  )
  const beforeMove = structuredClone(opened)
  const moved = moveTab(
    opened,
    { workspaceId, tabId: browserTabId, destinationPaneId, destinationIndex: 0 },
    4
  )
  const movedWorkspace = moved.workspaces[0]!
  expect(movedWorkspace.layout).toEqual(beforeMove.workspaces[0]!.layout)
  expect(movedWorkspace.panes[sourcePaneId]).toMatchObject({
    tabs: [terminalTabId],
    selectedTabId: terminalTabId
  })
  expect(movedWorkspace.panes[destinationPaneId]).toMatchObject({
    tabs: [browserTabId, destinationTabId],
    selectedTabId: browserTabId
  })
  expect(movedWorkspace.selectedPaneId).toBe(destinationPaneId)
  expect(opened).toEqual(beforeMove)

  const refocused = focusPane(moved, workspaceId, sourcePaneId, 5)
  const beforeCollapse = structuredClone(refocused)
  const collapsed = moveTab(
    refocused,
    { workspaceId, tabId: terminalTabId, destinationPaneId, destinationIndex: 1 },
    6
  ).workspaces[0]!
  expect(collapsed.layout).toEqual({ kind: 'leaf', paneId: destinationPaneId })
  expect(collapsed.panes[sourcePaneId]).toBeUndefined()
  expect(collapsed.panes[destinationPaneId]).toMatchObject({
    tabs: [browserTabId, terminalTabId, destinationTabId],
    selectedTabId: terminalTabId
  })
  expect(collapsed.selectedPaneId).toBe(destinationPaneId)
  expect(refocused).toEqual(beforeCollapse)
})

it('collapses a pane in the second subtree while preserving the input and surviving nodes', () => {
  const layout = {
    kind: 'split',
    splitId: 'root',
    axis: 'horizontal',
    ratio: 0.5,
    first: {
      kind: 'split',
      splitId: 'first',
      axis: 'vertical',
      ratio: 0.5,
      first: { kind: 'leaf', paneId: 'a' },
      second: { kind: 'leaf', paneId: 'b' }
    },
    second: {
      kind: 'split',
      splitId: 'second',
      axis: 'vertical',
      ratio: 0.5,
      first: { kind: 'leaf', paneId: 'c' },
      second: { kind: 'leaf', paneId: 'd' }
    }
  } satisfies PaneLayout
  const before = structuredClone(layout)

  const collapsed = collapsePane(layout, 'd')

  expect(collapsed).toEqual({ ...before, second: before.second.first })
  expect(collapsed.kind === 'split' && collapsed.first).toBe(layout.first)
  expect(collapsed.kind === 'split' && collapsed.second).toBe(layout.second.first)
  expect(layout).toEqual(before)
})

it('throws a pane_not_found mutation error when the pane is missing', () => {
  const layout: PaneLayout = {
    kind: 'split',
    splitId: 'root',
    axis: 'horizontal',
    ratio: 0.5,
    first: { kind: 'leaf', paneId: 'a' },
    second: { kind: 'leaf', paneId: 'b' }
  }

  expect(() => collapsePane(layout, 'missing')).toThrow(
    expect.objectContaining({
      constructor: WorkspaceMutationError,
      code: 'pane_not_found',
      message: 'Pane is not in the layout'
    })
  )
})

it('reopens a browser tab with a fresh session in the default partition', () => {
  const { state, windowId } = fixture()
  const workspace = state.workspaces[0]!
  const paneId = workspace.selectedPaneId
  const tabId = workspace.panes[paneId]!.selectedTabId
  const tab = workspace.tabs[tabId]!
  tab.title = 'Browser'
  tab.content = {
    kind: 'browser',
    metadata: {
      browserSessionId: randomUUID(),
      url: 'https://example.com/?page=2',
      navigationTitle: 'Example',
      canBack: true,
      canForward: true,
      loading: true,
      devToolsOpen: true,
      profilePartition: 'persist:custom',
      stateRevision: 7,
      correlationId: randomUUID()
    }
  }
  const closedId = randomUUID()
  const closed = closeTab(state, workspace.id, tabId, closedId, randomUUID(), 2)
  const restoredId = randomUUID()
  const browserSessionId = randomUUID()

  const restored = reopenClosedTab(
    closed,
    closedId,
    {
      windowId,
      workspaceId: workspace.id,
      paneId,
      destinationIndex: 1,
      expectedWindowRevision: closed.windowPlacements[0]!.revision
    },
    restoredId,
    browserSessionId,
    3
  )

  expect(restored.workspaces[0]!.tabs[restoredId]!.content).toStrictEqual({
    kind: 'browser',
    metadata: {
      browserSessionId,
      url: 'https://example.com/',
      navigationTitle: '',
      canBack: false,
      canForward: false,
      loading: false,
      devToolsOpen: false,
      profilePartition: 'persist:agent-workspace-default',
      stateRevision: 0,
      correlationId: null
    }
  })
})

it.each([false, true])(
  'preserves browser projection and navigation with explicit metadata: %s',
  (explicit) => {
    const { state } = fixture()
    const workspace = state.workspaces[0]!
    const tab = workspace.tabs[workspace.panes[workspace.selectedPaneId]!.selectedTabId]!
    const browserSessionId = randomUUID()
    const correlationId = randomUUID()
    const expected = {
      browserSessionId,
      url: 'https://example.com/',
      navigationTitle: explicit ? 'Example' : '',
      canBack: explicit,
      canForward: explicit,
      loading: explicit,
      devToolsOpen: explicit,
      profilePartition: explicit ? 'persist:custom' : 'persist:agent-workspace-default',
      stateRevision: explicit ? 7 : 0,
      correlationId: explicit ? correlationId : null
    }
    tab.content = {
      kind: 'browser',
      metadata: explicit ? { ...expected } : { browserSessionId, url: expected.url }
    }
    const before = structuredClone(state)
    expect(projectApplicationSnapshot(state).workspaces[0]!.tabs[0]!.content).toEqual({
      kind: 'browser',
      state: expected
    })
    const request = {
      browserSessionId,
      url: 'https://example.org/',
      expectedStateRevision: expected.stateRevision,
      correlationId
    }
    const next = navigateBrowser(state, request, 5)
    expect(projectApplicationSnapshot(next).workspaces[0]!.tabs[0]!.content).toEqual({
      kind: 'browser',
      state: {
        ...expected,
        url: request.url,
        loading: true,
        stateRevision: expected.stateRevision + 1,
        correlationId
      }
    })
    expect(next.revision).toBe(state.revision + 1)
    expect(next.workspaces[0]!.updatedAt).toBe(5)
    expect(() => navigateBrowser(next, request, 6)).toThrow(
      new BrowserMutationError('browser_state_stale', 'Browser state revision is stale')
    )
    expect(state).toEqual(before)
  }
)
