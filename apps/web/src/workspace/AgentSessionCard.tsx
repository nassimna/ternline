import { Card } from '../ui/card'
import { CardTitle } from '../ui/card'
import { Label } from '../ui/label'
import { useState, type FormEvent } from 'react'

import type {
  AgentAttentionSetResult,
  AgentAttentionState,
  AgentSessionSnapshot
} from '@agent-workspace/protocol-client'

import { messages } from '../messages'
import { Button } from '../ui/button'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'

export interface AgentForkDestination {
  destinationKind: 'existingTerminal' | 'newTerminal'
  workspaceId: string
  paneId: string
  tabId: string
}

export function AgentSessionCard({
  attention,
  assessmentOnly = false,
  allowRestore = !assessmentOnly,
  allowFork = !assessmentOnly,
  allowHibernate = !assessmentOnly,
  busy,
  existingDestinationAvailable,
  onAssess,
  onAttention,
  onFork,
  onHibernate,
  onNavigate,
  onRestore,
  session
}: {
  attention: AgentAttentionSetResult | undefined
  assessmentOnly?: boolean
  allowRestore?: boolean
  allowFork?: boolean
  allowHibernate?: boolean
  busy: boolean
  existingDestinationAvailable: boolean
  onAssess: () => void
  onAttention: (state: AgentAttentionState) => void
  onFork: (title: string, destination: 'existingTerminal' | 'newTerminal') => void
  onHibernate: () => void
  onNavigate: () => void
  onRestore: () => void
  session: AgentSessionSnapshot
}): React.JSX.Element {
  const [forkTitle, setForkTitle] = useState(`${session.title} fork`)
  const [destination, setDestination] = useState<'existingTerminal' | 'newTerminal'>(
    existingDestinationAvailable ? 'existingTerminal' : 'newTerminal'
  )
  const [attentionState, setAttentionState] = useState<AgentAttentionState>(
    attention?.state ?? 'informational'
  )
  const selectedDestination = existingDestinationAvailable ? destination : 'newTerminal'
  const submitFork = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onFork(forkTitle.trim(), selectedDestination)
  }
  return (
    <li className="agent-session-item">
      <Card asChild>
        <article
          aria-labelledby={`agent-session-${session.binding.agentSessionId}`}
          className="agent-session-card"
        >
          <CardTitle asChild>
            <h3 id={`agent-session-${session.binding.agentSessionId}`}>{session.title}</h3>
          </CardTitle>
          <div className="agent-session-facts">
            <p>
              {messages.agentSessions.lifecycle}: {session.lifecycle}
            </p>
            {session.hibernationState ? (
              <p>
                {messages.agentSessions.hibernationState}: {session.hibernationState}
              </p>
            ) : null}
            <p>
              {messages.agentSessions.restoreLevel}:{' '}
              {messages.agentSessions.restoreLevels[session.restore.level]}
            </p>
          </div>
          <code className="agent-session-id">{session.binding.agentSessionId}</code>
          {session.forkedFrom ? (
            <p className="agent-session-provenance">
              {messages.agentSessions.provenance}:{' '}
              <span>{session.forkedFrom.forkedFromAgentSessionId}</span> ·{' '}
              {session.forkedFrom.artifact.kind} ·{' '}
              <span>{session.forkedFrom.artifact.digestSha256}</span>
            </p>
          ) : null}
          <div
            className="agent-session-actions"
            role="group"
            aria-label={messages.agentSessions.sessionActions(session.title)}
          >
            <Button disabled={busy} onClick={onNavigate} size="small">
              {messages.agentSessions.navigate}
            </Button>
            <Button disabled={busy} onClick={onAssess} size="small">
              {messages.agentSessions.assess}
            </Button>
            {allowRestore ? (
              <Button
                disabled={busy || session.restore.level === 'unavailable'}
                onClick={onRestore}
                size="small"
              >
                {messages.agentSessions.restore}
              </Button>
            ) : null}
            {allowHibernate ? (
              <Button
                disabled={
                  busy ||
                  !['running', 'waiting'].includes(session.lifecycle) ||
                  Boolean(session.hibernationState)
                }
                onClick={onHibernate}
                size="small"
                variant="destructive"
              >
                {messages.agentSessions.hibernate}
              </Button>
            ) : null}
          </div>
          {allowFork ? (
            <form className="agent-session-fork" onSubmit={submitFork}>
              <Label>
                {messages.agentSessions.forkTitle}
                <Input
                  maxLength={160}
                  onChange={(event) => setForkTitle(event.currentTarget.value)}
                  required
                  value={forkTitle}
                />
              </Label>
              <fieldset>
                <legend>{messages.agentSessions.forkDestination}</legend>
                <RadioGroup
                  aria-label={messages.agentSessions.forkDestination}
                  name={`fork-destination-${session.binding.agentSessionId}`}
                  value={selectedDestination}
                  onValueChange={(value) => setDestination(value as typeof selectedDestination)}
                >
                  <Label>
                    <RadioGroupItem
                      value="existingTerminal"
                      disabled={!existingDestinationAvailable}
                    />
                    {messages.agentSessions.existingTerminal}
                  </Label>
                  <Label>
                    <RadioGroupItem value="newTerminal" />
                    {messages.agentSessions.newTerminal}
                  </Label>
                </RadioGroup>
              </fieldset>
              {!existingDestinationAvailable ? (
                <small>{messages.agentSessions.sourceDestinationBlocked}</small>
              ) : null}
              <Button disabled={busy || !forkTitle.trim()} size="small" type="submit">
                {messages.agentSessions.fork}
              </Button>
            </form>
          ) : null}
          {!assessmentOnly ? (
            <div
              className="agent-session-attention"
              role="group"
              aria-label={messages.agentSessions.attentionFor(session.title)}
            >
              <Label>
                {messages.agentSessions.attention}
                <Select
                  onValueChange={(value) => setAttentionState(value as AgentAttentionState)}
                  value={attentionState}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="informational">
                      {messages.agentSessions.informational}
                    </SelectItem>
                    <SelectItem value="completed">{messages.agentSessions.completed}</SelectItem>
                    <SelectItem value="waiting">{messages.agentSessions.waiting}</SelectItem>
                    <SelectItem value="urgent">{messages.agentSessions.urgent}</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Button disabled={busy} onClick={() => onAttention(attentionState)} size="small">
                {messages.agentSessions.setAttention}
              </Button>
            </div>
          ) : null}
        </article>
      </Card>
    </li>
  )
}
