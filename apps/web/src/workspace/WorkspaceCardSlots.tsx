import type { WorkspaceCardSlotsSnapshot } from '@agent-workspace/protocol-client'
import type { JSX } from 'react'

import { messages } from '../messages'
import { Progress } from '../ui/progress'

export function WorkspaceCardSlots({
  slots
}: {
  slots: WorkspaceCardSlotsSnapshot | undefined
}): JSX.Element | null {
  if (!slots?.agentStatus && !slots?.progress) return null
  const agentStatus = slots.agentStatus
  const progress = slots.progress
  const progressLabel = progress
    ? progress.mode === 'determinate'
      ? messages.workspaceCardSlots.progressAccessible(progress.value, progress.label)
      : messages.workspaceCardSlots.indeterminateAccessible(progress.label)
    : undefined
  return (
    <span className="workspace-card-slots">
      {agentStatus ? (
        <small aria-atomic="true" aria-live="polite" className="workspace-agent-status">
          <span className="workspace-card-slot-label">{messages.workspaceCardSlots.agent}:</span>{' '}
          {messages.workspaceCardSlots.agentStatus[agentStatus.status]}
          {agentStatus.label ? ` — ${agentStatus.label}` : ''}
        </small>
      ) : null}
      {progress ? (
        <span className="workspace-card-progress">
          <span className="workspace-card-progress-copy">
            {progress.label ? `${progress.label} · ` : ''}
            {progress.mode === 'determinate'
              ? `${String(progress.value)}%`
              : messages.workspaceCardSlots.inProgress}
          </span>
          <Progress
            aria-label={progressLabel}
            aria-valuetext={progressLabel}
            value={progress.mode === 'determinate' ? progress.value : null}
          />
        </span>
      ) : null}
    </span>
  )
}
