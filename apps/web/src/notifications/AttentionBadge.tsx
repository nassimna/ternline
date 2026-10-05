import { Badge } from '../ui/badge'
import type { AttentionSummary, WorkspaceAttentionSnapshot } from '@agent-workspace/protocol-client'

import { messages } from '../messages'

interface AttentionBadgeProps {
  attention: AttentionSummary | WorkspaceAttentionSnapshot
  announce?: boolean
  compact?: boolean
  label: string
}

export function AttentionBadge({
  attention,
  announce = true,
  compact = false,
  label
}: AttentionBadgeProps): React.JSX.Element | null {
  if ('state' in attention) {
    if (attention.state === 'none') return null
    const accessible = messages.attentionBadge.authoritativeSummary(
      label,
      attention.state,
      attention.unreadCount
    )
    const symbol =
      attention.state === 'completed'
        ? '✓'
        : attention.state === 'waiting'
          ? '…'
          : attention.state === 'urgent'
            ? '!'
            : 'i'
    return (
      <Badge
        size={compact ? 'small' : 'default'}
        data-attention={attention.state}
        variant={
          attention.state === 'urgent'
            ? 'destructive'
            : attention.state === 'waiting'
              ? 'warning'
              : attention.state === 'completed'
                ? 'success'
                : 'info'
        }
        aria-hidden={announce ? undefined : true}
        aria-label={announce ? accessible : undefined}
        className={`attention-badge attention-${attention.state}${compact ? ' compact' : ''}`}
        role={announce ? 'status' : undefined}
        title={accessible}
      >
        <span aria-hidden="true">{symbol}</span>
        <span>
          {attention.unreadCount > 0
            ? messages.attentionBadge.displayCount(attention.unreadCount)
            : messages.attentionBadge.stateLabel(attention.state)}
        </span>
      </Badge>
    )
  }
  if (attention.unreadCount === 0) return null
  const severity = attention.highestLevel ?? 'info'
  const title = attention.latestUnread?.title
  const accessible = messages.attentionBadge.accessibleSummary(
    label,
    attention.unreadCount,
    severity,
    title
  )
  return (
    <Badge
      size={compact ? 'small' : 'default'}
      variant={severity === 'error' ? 'destructive' : severity === 'warning' ? 'warning' : 'info'}
      aria-label={accessible}
      className={`attention-badge severity-${severity}${compact ? ' compact' : ''}`}
      role="status"
      title={accessible}
    >
      <span aria-hidden="true">!</span>
      <span>{messages.attentionBadge.displayCount(attention.unreadCount)}</span>
    </Badge>
  )
}
