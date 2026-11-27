import { randomUUID } from 'node:crypto'

import { durableApplicationStateSchema } from '@agent-workspace/contracts'
import { expect, it, vi } from 'vitest'

import {
  assertLayoutBindingsPreserved,
  planLayoutApplication,
  saveLayout
} from './layout-mutations'

function fixture() {
  const windowId = randomUUID()
  const workspaceId = randomUUID()
  const paneId = randomUUID()
  const tabId = randomUUID()
  const layoutId = randomUUID()
  const state = durableApplicationStateSchema.parse({
    revision: 1,
    workspaces: [
      {
        id: workspaceId,
        name: 'Workspace',
        description: null,
        color: null,
        workingDirectory: '/tmp',
        layout: { kind: 'leaf', paneId },
        selectedPaneId: paneId,
        panes: { [paneId]: { id: paneId, tabs: [tabId], selectedTabId: tabId, title: null } },
        tabs: {
          [tabId]: {
            id: tabId,
            paneId,
            title: 'Terminal',
            customTitle: null,
            content: { kind: 'terminal', launch: { cwd: '/tmp', rows: 24, cols: 80 } },
            createdAt: 1
          }
        },
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
        id: windowId,
        label: 'Main',
        workspaceIds: [workspaceId],
        focusedWorkspaceId: workspaceId,
        hostingState: 'hosted',
        revision: 1
      }
    ],
    focusedWindowId: windowId,
    focusHistory: { entries: [], cursor: 0 }
  })
  const saved = saveLayout(state, layoutId, 'Fresh workspace', [workspaceId], 2)
  const freshWorkspaceId = randomUUID()
  saved.savedLayouts[0]!.template.workspaces[0]!.id = freshWorkspaceId
  return { state: saved, windowId, layoutId, freshWorkspaceId }
}

it('refuses an imported layout that would remove a workspace needed by copy resume', () => {
  const { state, windowId, layoutId, freshWorkspaceId } = fixture()
  expect(state.workspaces[0]!.id).not.toBe(freshWorkspaceId)
  expect(() => planLayoutApplication(state, layoutId, randomUUID, windowId)).toThrow(
    'Saved layout would remove a workspace required by the copy'
  )
})

it('retains the hosted caller window when the layout preserves workspace identities', () => {
  const { state, windowId, layoutId } = fixture()
  state.savedLayouts[0]!.template.workspaces[0]!.id = state.workspaces[0]!.id
  const applied = planLayoutApplication(state, layoutId, randomUUID, windowId)
  expect(applied.windowPlacements[0]).toMatchObject({
    id: windowId,
    workspaceIds: [state.workspaces[0]!.id],
    hostingState: 'hosted'
  })
  expect(durableApplicationStateSchema.safeParse(applied).success).toBe(true)
})

it('allocates one fresh browser session when applying a layout browser tab', () => {
  const { state, layoutId } = fixture()
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  const tabId = template.panes[template.selectedPaneId]!.selectedTabId
  const url = 'https://example.com/'
  template.tabs[tabId]!.content = { kind: 'browser', url }
  const browserSessionId = randomUUID()
  const newId = vi.fn(() => browserSessionId)

  const applied = planLayoutApplication(state, layoutId, newId)

  expect(newId).toHaveBeenCalledTimes(1)
  expect(applied.workspaces[0]!.tabs[tabId]!.content).toStrictEqual({
    kind: 'browser',
    metadata: {
      browserSessionId,
      url,
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

it('clones the live browser metadata without allocating an ID when the portable URL matches', () => {
  const { state, layoutId, windowId } = fixture()
  const workspace = state.workspaces[0]!
  const tabId = workspace.panes[workspace.selectedPaneId]!.selectedTabId
  const expected = {
    browserSessionId: randomUUID(),
    url: 'https://example.com/?page=2#section',
    navigationTitle: 'Example',
    canBack: true,
    canForward: true,
    loading: true,
    devToolsOpen: true,
    profilePartition: 'persist:custom',
    stateRevision: 7,
    correlationId: randomUUID()
  }
  const liveMetadata = { ...expected }
  workspace.tabs[tabId]!.content = { kind: 'browser', metadata: liveMetadata }
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  template.id = workspace.id
  template.name = 'Renamed workspace'
  template.tabs[tabId]!.content = { kind: 'browser', url: 'https://example.com/' }
  const newId = vi.fn(randomUUID)

  const applied = planLayoutApplication(state, layoutId, newId, windowId)
  const content = applied.workspaces[0]!.tabs[tabId]!.content

  expect(newId).not.toHaveBeenCalled()
  if (content.kind !== 'browser') throw new Error('Expected a browser tab')
  expect(content.metadata).toStrictEqual(expected)
  expect(content.metadata).not.toBe(liveMetadata)
})

it('prunes removed tab focus before the cursor and preserves forward history', () => {
  const { state, windowId, layoutId } = fixture()
  const workspace = state.workspaces[0]!
  const pane = workspace.panes[workspace.selectedPaneId]!
  const current = {
    windowId,
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: pane.selectedTabId
  }
  const removed = { ...current, tabId: randomUUID() }
  const forward = { ...current, tabId: randomUUID() }
  const tab = workspace.tabs[current.tabId]!
  for (const { tabId } of [removed, forward]) {
    pane.tabs.push(tabId)
    workspace.tabs[tabId] = { ...tab, id: tabId }
  }
  state.focusHistory = { entries: [removed, current, forward], cursor: 1 }
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  template.id = workspace.id
  template.panes[pane.id]!.tabs.push(forward.tabId)
  template.tabs[forward.tabId] = { ...template.tabs[current.tabId]!, id: forward.tabId }
  const original = durableApplicationStateSchema.parse(state)

  const applied = planLayoutApplication(state, layoutId, randomUUID, windowId)

  expect(applied.focusHistory).toEqual({ entries: [current, forward], cursor: 0 })
  expect(state).toEqual(original)
})

it.each([
  { scenario: 'seeds empty history with the previous focus', hasForwardHistory: false },
  { scenario: 'discards valid forward history', hasForwardHistory: true }
])('$scenario when a layout selects a different tab', ({ hasForwardHistory }) => {
  const { state, windowId, layoutId } = fixture()
  const workspace = state.workspaces[0]!
  const pane = workspace.panes[workspace.selectedPaneId]!
  const current = {
    windowId,
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: pane.selectedTabId
  }
  const selected = { ...current, tabId: randomUUID() }
  const forward = { ...current, tabId: randomUUID() }
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  const templatePane = template.panes[pane.id]!
  template.id = workspace.id
  for (const { tabId } of [selected, forward]) {
    pane.tabs.push(tabId)
    workspace.tabs[tabId] = { ...workspace.tabs[current.tabId]!, id: tabId }
    templatePane.tabs.push(tabId)
    template.tabs[tabId] = { ...template.tabs[current.tabId]!, id: tabId }
  }
  templatePane.selectedTabId = selected.tabId
  if (hasForwardHistory) state.focusHistory = { entries: [current, forward], cursor: 0 }
  const original = durableApplicationStateSchema.parse(state)

  const applied = planLayoutApplication(state, layoutId, randomUUID, windowId)

  expect(applied.focusHistory).toStrictEqual({ entries: [current, selected], cursor: 1 })
  expect(state).toStrictEqual(original)
})

it.each(['hosted', 'unhosted'] as const)(
  'refuses layout apply when another %s window would disappear',
  (hostingState) => {
    const { state, windowId, layoutId } = fixture()
    const otherWindowId = randomUUID()
    const secondWorkspace = structuredClone(state.workspaces[0]!)
    const secondWorkspaceId = randomUUID()
    const secondPaneId = randomUUID()
    const secondTabId = randomUUID()
    const originalPane = secondWorkspace.panes[secondWorkspace.selectedPaneId]!
    const originalTab = secondWorkspace.tabs[originalPane.selectedTabId]!
    secondWorkspace.id = secondWorkspaceId
    secondWorkspace.layout = { kind: 'leaf', paneId: secondPaneId }
    secondWorkspace.selectedPaneId = secondPaneId
    secondWorkspace.panes = {
      [secondPaneId]: {
        ...originalPane,
        id: secondPaneId,
        tabs: [secondTabId],
        selectedTabId: secondTabId
      }
    }
    secondWorkspace.tabs = {
      [secondTabId]: { ...originalTab, id: secondTabId, paneId: secondPaneId }
    }
    state.workspaces.push(secondWorkspace)
    state.windowPlacements.push({
      id: otherWindowId,
      label: 'Second',
      workspaceIds: [secondWorkspaceId],
      focusedWorkspaceId: secondWorkspaceId,
      hostingState,
      revision: 1
    })
    expect(durableApplicationStateSchema.safeParse(state).success).toBe(true)
    const withFullLayout = saveLayout(
      state,
      layoutId,
      'Both workspaces',
      [secondWorkspaceId, state.selectedWorkspaceId],
      3
    )
    expect(() => planLayoutApplication(withFullLayout, layoutId, randomUUID, windowId)).toThrow(
      hostingState === 'hosted'
        ? 'Saved layout apply requires one hosted window'
        : 'Saved layout would remove another window'
    )
  }
)

it('refuses a target window without a live host', () => {
  const { state, windowId, layoutId } = fixture()
  state.windowPlacements[0]!.hostingState = 'unhosted'
  expect(() => planLayoutApplication(state, layoutId, randomUUID, windowId)).toThrow(
    'Window is not hosted'
  )
})

it('preserves exact catalog tab bindings when a layout replaces pane content', () => {
  const { state, windowId, layoutId } = fixture()
  const workspace = state.workspaces[0]!
  const originalPane = workspace.panes[workspace.selectedPaneId]!
  const oldTabId = originalPane.selectedTabId
  const replacementTabId = randomUUID()
  const oldFocus = { windowId, workspaceId: workspace.id, paneId: originalPane.id, tabId: oldTabId }
  state.focusHistory = { entries: [oldFocus], cursor: 0 }
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  template.id = workspace.id
  const oldTab = template.tabs[oldTabId]!
  template.panes[template.selectedPaneId]!.tabs = [replacementTabId]
  template.panes[template.selectedPaneId]!.selectedTabId = replacementTabId
  delete template.tabs[oldTabId]
  template.tabs[replacementTabId] = { ...oldTab, id: replacementTabId }
  const candidate = planLayoutApplication(state, layoutId, randomUUID, windowId)
  expect(durableApplicationStateSchema.safeParse(candidate).success).toBe(true)
  expect(candidate.focusHistory).toEqual({
    entries: [{ ...oldFocus, tabId: replacementTabId }],
    cursor: 0
  })
  expect(() =>
    assertLayoutBindingsPreserved(state, candidate, [
      {
        workspaceId: workspace.id,
        paneId: originalPane.id,
        tabId: oldTabId
      }
    ])
  ).toThrow('Saved layout would remove an agent or remote session binding')
})

it('refuses to replace the launch of a catalog-bound terminal with the same IDs', () => {
  const { state, windowId, layoutId } = fixture()
  const workspace = state.workspaces[0]!
  const paneId = workspace.selectedPaneId
  const tabId = workspace.panes[paneId]!.selectedTabId
  const template = state.savedLayouts[0]!.template.workspaces[0]!
  template.id = workspace.id
  const tab = template.tabs[tabId]!
  if (tab.content.kind !== 'terminal') throw new Error('Expected terminal template')
  tab.content.launch = { ...tab.content.launch, cols: 100 }
  const candidate = planLayoutApplication(state, layoutId, randomUUID, windowId)
  expect(() =>
    assertLayoutBindingsPreserved(state, candidate, [{ workspaceId: workspace.id, paneId, tabId }])
  ).toThrow('Saved layout would remove an agent or remote session binding')
})
