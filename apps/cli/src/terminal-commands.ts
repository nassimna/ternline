import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import type { AgentWorkspaceClient } from '@agent-workspace/client-runtime'
import { tabUpdateRequestSchema } from '@agent-workspace/contracts'
import { flags, required } from './options'

export type TerminalCommand =
  | { sessionFile: string; command: 'terminal.read'; terminalId: string; lines?: number }
  | { sessionFile: string; command: 'terminal.ports'; terminalId: string }
  | { sessionFile: string; command: 'tab.rename'; tabId: string; title: string }

export function parseTerminalCommand(
  args: string[],
  sessionFile: string
): TerminalCommand | undefined {
  if (args[0] === 'terminal' && args[1] === 'ports') {
    const { values } = flags(args.slice(2), ['--terminal-id'])
    return {
      sessionFile,
      command: 'terminal.ports',
      terminalId: required(values, '--terminal-id')
    }
  }
  if (args[0] === 'terminal' && args[1] === 'read') {
    const { values } = flags(args.slice(2), ['--terminal-id', '--lines'])
    const raw = values.get('--lines')
    if (raw !== undefined && (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(Number(raw)))) {
      throw new Error('--lines must be a positive integer')
    }
    return {
      sessionFile,
      command: 'terminal.read',
      terminalId: required(values, '--terminal-id'),
      ...(raw === undefined ? {} : { lines: Number(raw) })
    }
  }
  if (args[0] === 'tab' && args[1] === 'rename') {
    const { values } = flags(args.slice(2), ['--tab-id', '--title'])
    return {
      sessionFile,
      command: 'tab.rename',
      tabId: required(values, '--tab-id'),
      title: required(values, '--title')
    }
  }
  return undefined
}

export async function readTerminalText(
  client: AgentWorkspaceClient,
  terminalId: string,
  lines?: number
) {
  const attached = await client.attach(terminalId)
  const replayBytes = Buffer.allocUnsafe(
    attached.output.reduce((size, chunk) => size + Buffer.byteLength(chunk.data, 'base64'), 0)
  )
  let offset = 0
  for (const chunk of attached.output) {
    offset += replayBytes.write(chunk.data, offset, 'base64')
  }
  const replay = replayBytes.toString('utf8', 0, offset)
  const text = stripVTControlCharacters((attached.checkpoint?.data ?? '') + replay).replace(
    /\r\n?/gu,
    '\n'
  )
  let start = 0
  if (lines !== undefined) {
    let delimiter = text.endsWith('\n') ? text.length - 1 : text.length
    let remaining = lines
    while (remaining > 0 && delimiter > 0) {
      delimiter = text.lastIndexOf('\n', delimiter - 1)
      remaining--
    }
    if (remaining === 0) start = delimiter + 1
  }
  return {
    text: text.slice(start),
    reconstructionComplete: attached.reconstructionComplete
  }
}

export async function renameTab(client: AgentWorkspaceClient, tabId: string, title: string) {
  const identity = await client.identify()
  if (!identity.capabilities.includes('tab.update') || !identity.idempotencyEpoch) {
    throw new Error('tab.update is unavailable in this Node session')
  }
  const { snapshot } = await client.stateSnapshot()
  const workspace = snapshot.workspaces.find((item) => Object.hasOwn(item.tabs, tabId))
  if (!workspace) throw new Error('Tab was not found')
  return client.updateTab(
    tabUpdateRequestSchema.parse({
      workspaceId: workspace.id,
      tabId,
      customTitle: { value: title },
      expectedRevision: snapshot.revision,
      idempotencyEpoch: identity.idempotencyEpoch,
      idempotencyKey: randomUUID()
    })
  )
}
