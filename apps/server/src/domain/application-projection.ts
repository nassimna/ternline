import {
  applicationSnapshotSchema,
  paneTreeNodeSchema,
  type ApplicationSnapshot,
  type DurableApplicationState
} from '@agent-workspace/contracts'

type Notification = DurableApplicationState['notifications'][number]
type AttentionSummary = ApplicationSnapshot['attention']
type AttentionAggregate = {
  unreadCount: number
  highestLevel: AttentionSummary['highestLevel']
  latestUnread: Notification | null
}
type PaneTree = ApplicationSnapshot['workspaces'][number]['layout']

const DEFAULT_SHORTCUT_COMMAND_IDS = [
  'workspace.new',
  'terminal.new',
  'tab.close',
  'pane.splitRight',
  'pane.splitDown',
  'sidebar.toggle',
  'commandPalette.toggle',
  'terminal.search',
  'browser.openSplit',
  'notifications.toggle',
  'notifications.latestUnread',
  'settings.open'
] as const

const severity = { info: 0, warning: 1, error: 2 } as const

function emptyAttention(): AttentionAggregate {
  return { unreadCount: 0, highestLevel: null, latestUnread: null }
}

function include(summary: AttentionAggregate, notification: Notification): void {
  summary.unreadCount += 1
  if (
    summary.highestLevel === null ||
    severity[notification.level] > severity[summary.highestLevel]
  ) {
    summary.highestLevel = notification.level
  }
  const latest = summary.latestUnread
  if (
    latest === null ||
    notification.createdAt > latest.createdAt ||
    (notification.createdAt === latest.createdAt && notification.id > latest.id)
  ) {
    summary.latestUnread = notification
  }
}

function includeFor(
  summaries: Map<string, AttentionAggregate>,
  id: string,
  notification: Notification
): void {
  let summary = summaries.get(id)
  if (!summary) {
    summary = emptyAttention()
    summaries.set(id, summary)
  }
  include(summary, notification)
}

function projectAttention(summary: AttentionAggregate | undefined): AttentionSummary {
  const latest = summary?.latestUnread
  return {
    unreadCount: summary?.unreadCount ?? 0,
    highestLevel: summary?.highestLevel ?? null,
    latestUnread: latest
      ? {
          notificationId: latest.id,
          title: latest.title,
          bodyExcerpt: latest.body === null ? null : /^.{0,160}/su.exec(latest.body)![0].trimEnd(),
          source: latest.source,
          createdAt: latest.createdAt
        }
      : null
  }
}

function paneOrder(layout: PaneTree): string[] {
  if (layout.kind === 'leaf') return [layout.paneId]
  return [...paneOrder(layout.first), ...paneOrder(layout.second)]
}

export function projectBrowserState(
  metadata: Extract<
    DurableApplicationState['workspaces'][number]['tabs'][string]['content'],
    { kind: 'browser' }
  >['metadata']
) {
  return {
    browserSessionId: metadata.browserSessionId,
    url: metadata.url,
    navigationTitle: metadata.navigationTitle ?? '',
    canBack: metadata.canBack ?? false,
    canForward: metadata.canForward ?? false,
    loading: metadata.loading ?? false,
    devToolsOpen: metadata.devToolsOpen ?? false,
    profilePartition: metadata.profilePartition ?? 'persist:agent-workspace-default',
    stateRevision: metadata.stateRevision ?? 0,
    correlationId: metadata.correlationId ?? null
  }
}

/** Project durable Rust state into the exact renderer and CLI workspace snapshot shape. */
export function projectApplicationSnapshot(
  state: DurableApplicationState,
  sessionForTab?: (tabId: string) => string | undefined
): ApplicationSnapshot {
  const applicationAttention = emptyAttention()
  const workspaceAttention = new Map<string, AttentionAggregate>()
  const paneAttention = new Map<string, AttentionAggregate>()
  const tabAttention = new Map<string, AttentionAggregate>()
  const tabOwners = new Map<string, { workspaceId: string; paneId: string }>()
  for (const workspace of state.workspaces) {
    for (const tab of Object.values(workspace.tabs)) {
      tabOwners.set(tab.id, { workspaceId: workspace.id, paneId: tab.paneId })
    }
  }
  for (const notification of state.notifications) {
    if (notification.readAt !== null) continue
    include(applicationAttention, notification)
    if (notification.tabId !== null) {
      const owner = tabOwners.get(notification.tabId)
      if (!owner) continue
      includeFor(workspaceAttention, owner.workspaceId, notification)
      includeFor(paneAttention, owner.paneId, notification)
      includeFor(tabAttention, notification.tabId, notification)
      continue
    }
    const workspace = state.workspaces.find((item) => item.id === notification.workspaceId)
    if (!workspace) continue
    if (notification.paneId !== null) {
      if (!workspace.panes[notification.paneId]) continue
      includeFor(paneAttention, notification.paneId, notification)
    }
    includeFor(workspaceAttention, workspace.id, notification)
  }

  const workspaces = state.workspaces.map((workspace) => {
    const layout = paneTreeNodeSchema.parse(workspace.layout)
    const orderedPanes = paneOrder(layout)
    const panes = orderedPanes.map((paneId) => {
      const pane = workspace.panes[paneId]!
      return {
        id: pane.id,
        tabIds: pane.tabs,
        selectedTabId: pane.selectedTabId,
        title: pane.title,
        attention: projectAttention(paneAttention.get(pane.id))
      }
    })
    const tabs = orderedPanes.flatMap((paneId) =>
      workspace.panes[paneId]!.tabs.map((tabId) => {
        const tab = workspace.tabs[tabId]!
        const runtimeSessionId =
          tab.content.kind === 'terminal' ? sessionForTab?.(tab.id) : undefined
        const content =
          tab.content.kind === 'terminal'
            ? {
                kind: 'terminal' as const,
                launch: tab.content.launch,
                ...(runtimeSessionId ? { runtimeSessionId } : {})
              }
            : {
                kind: 'browser' as const,
                state: projectBrowserState(tab.content.metadata)
              }
        return {
          id: tab.id,
          paneId: tab.paneId,
          title: tab.title,
          customTitle: tab.customTitle,
          content,
          attention: projectAttention(tabAttention.get(tab.id)),
          createdAt: tab.createdAt
        }
      })
    )
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      color: workspace.color,
      workingDirectory: workspace.workingDirectory,
      ...(workspace.environment === undefined ? {} : { environment: workspace.environment }),
      ...(workspace.ssh === undefined ? {} : { ssh: workspace.ssh }),
      layout,
      selectedPaneId: workspace.selectedPaneId,
      panes,
      tabs,
      attention: projectAttention(workspaceAttention.get(workspace.id)),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    }
  })
  const shortcutOverrides = DEFAULT_SHORTCUT_COMMAND_IDS.flatMap((commandId) => {
    const shortcut = state.shortcutOverrides[commandId]
    return shortcut === undefined ? [] : [{ commandId, shortcut }]
  })
  return applicationSnapshotSchema.parse({
    revision: state.revision,
    workspaces,
    selectedWorkspaceId: state.selectedWorkspaceId,
    shortcutOverrides,
    attention: projectAttention(applicationAttention)
  })
}
