import {
  durableApplicationStateSchema,
  type DurableApplicationState
} from '@agent-workspace/contracts'
import { tabMoveExactParamsSchema } from '@agent-workspace/protocol-client'
import type { z } from 'zod'

import { pruneHistory, recordFocus, WindowMutationError } from './window-mutations'
import { collapsePane, type PaneLayout as Layout } from './workspace-mutations'

type Request = z.infer<typeof tabMoveExactParamsSchema>

/** Moves one live terminal or browser identity into an exact durable destination. */
export function moveExactTab(
  state: DurableApplicationState,
  input: Request,
  now: number
): DurableApplicationState {
  const request = tabMoveExactParamsSchema.parse(input)
  const sourceWindow = state.windowPlacements.find((item) => item.id === request.source.windowId)
  const targetWindow = state.windowPlacements.find((item) => item.id === request.target.windowId)
  if (!sourceWindow)
    throw new WindowMutationError('source_not_found', 'Source window is unavailable')
  if (!targetWindow)
    throw new WindowMutationError('target_not_found', 'Target window is unavailable')
  if (
    sourceWindow.revision !== request.source.expectedWindowRevision ||
    targetWindow.revision !== request.target.expectedWindowRevision
  ) {
    throw new WindowMutationError('stale_window_revision', 'Window placement changed')
  }
  if (!sourceWindow.workspaceIds.includes(request.source.workspaceId))
    throw new WindowMutationError('source_not_found', 'Source workspace is not in its window')
  if (
    !targetWindow.workspaceIds.includes(request.target.workspaceId) ||
    targetWindow.hostingState !== 'hosted'
  ) {
    throw new WindowMutationError('target_not_found', 'Target workspace is not hosted')
  }
  const original = state.workspaces.find((item) => item.id === request.source.workspaceId)
  const destination = state.workspaces.find((item) => item.id === request.target.workspaceId)
  const originalTab = original?.tabs[request.source.tabId]
  const originalPane = original?.panes[request.source.paneId]
  const destinationPane = destination?.panes[request.target.paneId]
  if (
    !originalTab ||
    originalTab.paneId !== request.source.paneId ||
    !originalPane?.tabs.includes(originalTab.id)
  ) {
    throw new WindowMutationError('source_not_found', 'Source tab is unavailable')
  }
  if (!destination || !destinationPane)
    throw new WindowMutationError('target_not_found', 'Target pane is unavailable')
  if (
    originalTab.content.kind !== 'terminal' &&
    (originalTab.content.kind !== 'browser' || !originalTab.content.metadata.browserSessionId)
  )
    throw new WindowMutationError('policy_denied', 'Tab has no transferable runtime identity')
  if (request.target.destinationIndex > destinationPane.tabs.length)
    throw new WindowMutationError('target_not_found', 'Target index is outside the pane')
  if (original !== destination && Object.keys(original.tabs).length === 1)
    throw new WindowMutationError('policy_denied', 'The source workspace needs a terminal')
  if (state.legacyOverLimit || !Number.isSafeInteger(now) || now < 0)
    throw new WindowMutationError('policy_denied', 'Tab move is unavailable in this state')
  if (
    state.revision >= Number.MAX_SAFE_INTEGER ||
    sourceWindow.revision >= Number.MAX_SAFE_INTEGER ||
    targetWindow.revision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new WindowMutationError('resource_limit', 'Revision cannot advance')
  }
  if (original !== destination && Object.keys(destination.tabs).length >= 128)
    throw new WindowMutationError('resource_limit', 'Target workspace is full')

  const next = structuredClone(state)
  const from = next.workspaces.find((item) => item.id === request.source.workspaceId)!
  const to = next.workspaces.find((item) => item.id === request.target.workspaceId)!
  const sourcePane = from.panes[request.source.paneId]!
  const targetPane = to.panes[request.target.paneId]!
  const sourceIndex = sourcePane.tabs.indexOf(request.source.tabId)
  let insertionIndex = request.target.destinationIndex
  if (sourcePane === targetPane && sourceIndex < insertionIndex) insertionIndex -= 1
  if (sourcePane === targetPane && sourceIndex === insertionIndex)
    throw new WindowMutationError('policy_denied', 'Tab is already at the target index')

  sourcePane.tabs.splice(sourceIndex, 1)
  if (sourcePane !== targetPane) {
    if (sourcePane.tabs.length === 0) {
      from.layout = collapsePane(from.layout as Layout, sourcePane.id)
      delete from.panes[sourcePane.id]
      if (from.selectedPaneId === sourcePane.id) {
        from.selectedPaneId = Object.keys(from.panes)[0]!
      }
    } else if (sourcePane.selectedTabId === request.source.tabId) {
      sourcePane.selectedTabId = sourcePane.tabs[Math.min(sourceIndex, sourcePane.tabs.length - 1)]!
    }
    if (from !== to) {
      const moved = from.tabs[request.source.tabId]!
      delete from.tabs[request.source.tabId]
      to.tabs[request.source.tabId] = { ...moved, paneId: targetPane.id }
    } else {
      from.tabs[request.source.tabId]!.paneId = targetPane.id
    }
  }
  targetPane.tabs.splice(insertionIndex, 0, request.source.tabId)
  targetPane.selectedTabId = request.source.tabId
  to.selectedPaneId = targetPane.id
  from.updatedAt = now
  to.updatedAt = now
  const targetPlacement = next.windowPlacements.find((item) => item.id === targetWindow.id)!
  const sourcePlacement = next.windowPlacements.find((item) => item.id === sourceWindow.id)!
  sourcePlacement.revision += 1
  if (sourcePlacement !== targetPlacement) targetPlacement.revision += 1
  targetPlacement.focusedWorkspaceId = to.id
  next.focusedWindowId = targetPlacement.id
  next.selectedWorkspaceId = to.id
  next.workspaceSelection = [to.id]
  pruneHistory(next)
  recordFocus(next, {
    windowId: targetPlacement.id,
    workspaceId: to.id,
    paneId: targetPane.id,
    tabId: request.source.tabId
  })
  next.revision += 1
  return durableApplicationStateSchema.parse(next)
}
