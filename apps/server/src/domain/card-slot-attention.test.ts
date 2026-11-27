import { describe, expect, it } from 'vitest'
import type { DurableApplicationState } from '@agent-workspace/contracts'
import {
  CardSlotAttentionError,
  CardSlotAttentionService,
  type CardSlotAttentionEvent
} from './card-slot-attention'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const paneId = '20000000-0000-4000-8000-000000000002'
const tabId = '30000000-0000-4000-8000-000000000003'
const infoId = '40000000-0000-4000-8000-000000000004'
const errorId = '50000000-0000-4000-8000-000000000005'

function fixture(): DurableApplicationState {
  return {
    revision: 1,
    selectedWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        selectedPaneId: paneId,
        panes: { [paneId]: { id: paneId, selectedTabId: tabId } },
        tabs: { [tabId]: { id: tabId, paneId } }
      }
    ],
    notifications: [
      { id: infoId, workspaceId, paneId, tabId, level: 'info', createdAt: 1, readAt: null },
      { id: errorId, workspaceId, paneId, tabId, level: 'error', createdAt: 2, readAt: null }
    ]
  } as unknown as DurableApplicationState
}

describe('process-local card slots and attention', () => {
  it.each([
    [null, null, 'none', 'none'],
    [null, 'info', 'informational', 'notificationInfo'],
    [null, 'warning', 'informational', 'notificationWarning'],
    [null, 'error', 'urgent', 'notificationError'],
    ['idle', null, 'none', 'none'],
    ['idle', 'info', 'informational', 'notificationInfo'],
    ['idle', 'warning', 'informational', 'notificationWarning'],
    ['idle', 'error', 'urgent', 'notificationError'],
    ['running', null, 'informational', 'agentRunning'],
    ['running', 'info', 'informational', 'notificationInfo'],
    ['running', 'warning', 'informational', 'notificationWarning'],
    ['running', 'error', 'urgent', 'notificationError'],
    ['waiting', null, 'waiting', 'agentWaiting'],
    ['waiting', 'info', 'waiting', 'agentWaiting'],
    ['waiting', 'warning', 'waiting', 'agentWaiting'],
    ['waiting', 'error', 'urgent', 'notificationError'],
    ['completed', null, 'completed', 'agentCompleted'],
    ['completed', 'info', 'completed', 'agentCompleted'],
    ['completed', 'warning', 'completed', 'agentCompleted'],
    ['completed', 'error', 'urgent', 'notificationError'],
    ['failed', null, 'urgent', 'agentFailed'],
    ['failed', 'info', 'urgent', 'agentFailed'],
    ['failed', 'warning', 'urgent', 'agentFailed'],
    ['failed', 'error', 'urgent', 'notificationError']
  ] as const)(
    'folds agent %s with notification %s into %s (%s)',
    (status, level, attentionState, reason) => {
      const state = fixture()
      state.notifications = level === null ? [] : [{ ...state.notifications[0]!, level }]
      const before = structuredClone(state)
      const service = new CardSlotAttentionService(() => state)
      if (status !== null) {
        service.replaceSlots({
          workspaceId,
          expectedRevision: 0,
          agentStatus: { status, label: null },
          progress: null
        })
      }

      expect(service.getAttention({ workspaceId })).toEqual({
        workspaceId,
        revision: 0,
        state: attentionState,
        reason,
        unreadCount: level === null ? 0 : 1,
        ...(reason.startsWith('notification') ? { notificationId: infoId, paneId, tabId } : {})
      })
      expect(state).toEqual(before)
    }
  )

  it('uses per-slot CAS, no-op replacements, and bounded reconnect invalidations', () => {
    const state = fixture()
    const service = new CardSlotAttentionService(() => state)
    const events: string[] = []
    service.subscribe((event) => events.push(event.event))
    expect(service.getSlots({ workspaceId }).revision).toBe(0)
    const request = {
      workspaceId,
      expectedRevision: 0,
      agentStatus: { status: 'waiting' as const, label: null },
      progress: null
    }
    expect(service.replaceSlots(request).revision).toBe(1)
    expect(service.replaceSlots({ ...request, expectedRevision: 1 }).revision).toBe(1)
    expect(() => service.replaceSlots(request)).toThrow(CardSlotAttentionError)
    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 0,
      state: 'urgent',
      reason: 'notificationError',
      unreadCount: 2,
      notificationId: errorId
    })
    expect(events).toEqual(['workspace.cardSlotsChanged', 'workspace.projectionInvalidated'])
    const resync = service.resyncEvents()
    expect(resync.filter((event) => event.event === 'workspace.cardSlots.v2Changed')).toHaveLength(
      9
    )
    expect(resync).toContainEqual({
      event: 'workspace.projectionInvalidated',
      data: { revision: 1 }
    })
    expect(resync).toContainEqual({
      event: 'workspace.cardSlotsChanged',
      data: { workspaceId, slotRevision: 1, reason: 'slotsReplaced' }
    })
  })

  it('invalidates the projection when the application revision changes without attention changes', () => {
    const state = fixture()
    const service = new CardSlotAttentionService(() => state)
    service.resyncEvents()
    const events: string[] = []
    service.subscribe((event) => events.push(event.event))

    state.revision += 1
    service.refreshAttention()

    expect(events).toEqual(['workspace.projectionInvalidated'])
    expect(service.resyncEvents()[0]).toEqual({
      event: 'workspace.projectionInvalidated',
      data: { revision: 2 }
    })
  })

  it('keeps notification priority and increments attention only on projection changes', () => {
    const state = fixture()
    const service = new CardSlotAttentionService(() => state)
    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 0,
      reason: 'notificationError',
      unreadCount: 2
    })
    state.notifications[1]!.readAt = 3
    state.revision += 1
    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 1,
      reason: 'notificationInfo',
      unreadCount: 1,
      notificationId: infoId
    })
    state.revision += 1
    expect(service.getAttention({ workspaceId }).revision).toBe(1)
    service.replaceSlots({
      workspaceId,
      expectedRevision: 0,
      agentStatus: { status: 'failed', label: null },
      progress: null
    })
    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 2,
      reason: 'agentFailed',
      unreadCount: 1
    })
  })

  it('projects interleaved notifications and acknowledgements in their own workspaces', () => {
    const state = fixture()
    const otherWorkspaceId = '60000000-0000-4000-8000-000000000006'
    const otherNotificationId = '70000000-0000-4000-8000-000000000007'
    const missingTargetId = '80000000-0000-4000-8000-000000000008'
    const otherPaneId = '90000000-0000-4000-8000-000000000009'
    const otherTabId = 'a0000000-0000-4000-8000-00000000000a'
    const wrongPaneId = '10000000-0000-4000-8000-000000000010'
    const secondaryTabId = '10000000-0000-4000-8000-000000000011'
    state.workspaces.push({
      ...state.workspaces[0]!,
      id: otherWorkspaceId,
      selectedPaneId: otherPaneId,
      panes: {
        [otherPaneId]: {
          ...state.workspaces[0]!.panes[paneId]!,
          id: otherPaneId,
          tabs: [otherTabId],
          selectedTabId: otherTabId
        },
        [wrongPaneId]: {
          ...state.workspaces[0]!.panes[paneId]!,
          id: wrongPaneId,
          tabs: [secondaryTabId],
          selectedTabId: secondaryTabId
        }
      },
      tabs: {
        [otherTabId]: { ...state.workspaces[0]!.tabs[tabId]!, id: otherTabId, paneId: otherPaneId },
        [secondaryTabId]: {
          ...state.workspaces[0]!.tabs[tabId]!,
          id: secondaryTabId,
          paneId: wrongPaneId
        }
      }
    })
    const info = state.notifications[0]!
    const error = state.notifications[1]!
    const otherNotification = {
      ...error,
      id: otherNotificationId,
      workspaceId: otherWorkspaceId,
      paneId: null,
      tabId: otherTabId
    }
    const otherWarning = {
      ...otherNotification,
      id: 'e0000000-0000-4000-8000-00000000000e',
      level: 'warning' as const,
      createdAt: 3
    }
    state.notifications = [
      otherNotification,
      { ...info, level: 'error', createdAt: error.createdAt },
      {
        ...otherNotification,
        id: 'b0000000-0000-4000-8000-00000000000b',
        paneId: missingTargetId,
        tabId: null,
        createdAt: 3
      },
      error,
      otherWarning,
      {
        ...otherNotification,
        id: 'c0000000-0000-4000-8000-00000000000c',
        tabId: missingTargetId,
        createdAt: 4
      },
      {
        ...otherNotification,
        id: 'f0000000-0000-4000-8000-00000000000f',
        paneId: wrongPaneId,
        createdAt: 5
      },
      { ...error, id: 'd0000000-0000-4000-8000-00000000000d', createdAt: 5, readAt: 6 }
    ]
    const service = new CardSlotAttentionService(() => state)

    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 0,
      unreadCount: 2,
      notificationId: errorId,
      paneId,
      tabId
    })
    expect(service.getAttention({ workspaceId: otherWorkspaceId })).toMatchObject({
      revision: 0,
      reason: 'notificationError',
      unreadCount: 2,
      notificationId: otherNotificationId,
      paneId: otherPaneId,
      tabId: otherTabId
    })

    const candidate = {
      ...state,
      revision: state.revision + 1,
      notifications: state.notifications.map((notification) =>
        notification.id === otherNotificationId ? { ...notification, readAt: 7 } : notification
      )
    }
    expect(service.projectAcknowledged(candidate, otherWorkspaceId)).toEqual({
      revision: 1,
      attention: {
        workspaceId: otherWorkspaceId,
        revision: 1,
        state: 'informational',
        reason: 'notificationWarning',
        unreadCount: 1,
        notificationId: otherWarning.id,
        paneId: otherPaneId,
        tabId: otherTabId
      }
    })

    const events: CardSlotAttentionEvent[] = []
    service.subscribe((event) => events.push(event))
    error.readAt = 7
    otherNotification.readAt = 7
    otherWarning.readAt = 7
    state.revision += 1
    service.refreshAttention()

    expect(service.getAttention({ workspaceId })).toMatchObject({
      revision: 1,
      unreadCount: 1,
      notificationId: infoId
    })
    expect(service.getAttention({ workspaceId: otherWorkspaceId })).toEqual({
      workspaceId: otherWorkspaceId,
      revision: 1,
      state: 'none',
      reason: 'none',
      unreadCount: 0
    })
    expect(events).toEqual([
      { event: 'workspace.projectionInvalidated', data: { revision: 2 } },
      {
        event: 'workspace.attentionChanged',
        data: { workspaceId, attentionRevision: 1, reason: 'sourcesChanged' }
      },
      {
        event: 'workspace.attentionChanged',
        data: { workspaceId: otherWorkspaceId, attentionRevision: 1, reason: 'sourcesChanged' }
      }
    ])
  })

  it('accepts a complete v2 replacement through the strict GET lookup', () => {
    const state = fixture()
    const service = new CardSlotAttentionService(() => state)
    const events: string[] = []
    service.subscribe((event) => events.push(event.event))
    const request = {
      workspaceId,
      kind: 'markdown' as const,
      expectedRevision: 0,
      payload: { kind: 'markdown' as const, value: { source: '# Ready' } }
    }
    expect(service.replaceSlotV2(request)).toEqual({
      workspaceId,
      kind: 'markdown',
      slotRevision: 1,
      payload: request.payload
    })
    expect(service.replaceSlotV2({ ...request, expectedRevision: 1 }).slotRevision).toBe(1)
    expect(() => service.replaceSlotV2(request)).toThrowError(
      expect.objectContaining({ code: 'revision_conflict' })
    )
    expect(events).toEqual(['workspace.cardSlots.v2Changed'])
  })

  it('checks exact focus and attention revision for an acknowledgement', () => {
    const state = fixture()
    state.notifications[1]!.paneId = null
    const service = new CardSlotAttentionService(() => state)
    const params = {
      notificationId: errorId,
      expectedRevision: 0,
      idempotencyKey: '60000000-0000-4000-8000-000000000006',
      mode: 'focused' as const
    }
    expect(service.prepareAcknowledgement(params)).toMatchObject({
      notificationId: errorId,
      workspaceId
    })
    state.workspaces[0]!.selectedPaneId = '70000000-0000-4000-8000-000000000007'
    expect(() => service.prepareAcknowledgement(params)).toThrowError(/focused/)
  })
})
