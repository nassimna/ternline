import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { AgentWorkspaceClient } from '@agent-workspace/client-runtime'
import { parseTerminalCommand, readTerminalText, renameTab } from './terminal-commands'

void test('terminal ports requires a terminal ID and rejects unrelated options', () => {
  const terminalId = randomUUID()
  assert.deepEqual(
    parseTerminalCommand(['terminal', 'ports', '--terminal-id', terminalId], '/private/session'),
    { sessionFile: '/private/session', command: 'terminal.ports', terminalId }
  )
  assert.throws(
    () => parseTerminalCommand(['terminal', 'ports'], '/private/session'),
    /--terminal-id is required/
  )
  assert.throws(
    () =>
      parseTerminalCommand(
        ['terminal', 'ports', '--terminal-id', terminalId, '--lines', '2'],
        '/private/session'
      ),
    /Unknown or repeated option/
  )
})

void test('terminal read joins decoded chunks before decoding UTF8, strips controls, and tails complete lines', async () => {
  const bytes = Buffer.from('\u001b[32mfirst\u001b[0m\r\nsecond: café\r\nthird\r\n')
  const split = bytes.indexOf(Buffer.from('é')) + 1
  const client = {
    attach: () =>
      Promise.resolve({
        checkpoint: { data: 'checkpoint\n' },
        output: [
          { data: bytes.subarray(0, split).toString('base64') },
          { data: bytes.subarray(split).toString('base64') }
        ],
        reconstructionComplete: true
      })
  } as unknown as AgentWorkspaceClient
  assert.deepEqual(await readTerminalText(client, randomUUID()), {
    text: 'checkpoint\nfirst\nsecond: café\nthird\n',
    reconstructionComplete: true
  })
  assert.equal((await readTerminalText(client, randomUUID(), 2)).text, 'second: café\nthird\n')
  assert.throws(
    () =>
      parseTerminalCommand(
        ['terminal', 'read', '--terminal-id', randomUUID(), '--lines', '0'],
        '/private/session'
      ),
    /--lines must be a positive integer/
  )
})

void test('terminal read appends tolerant base64 chunks by their decoded lengths', async () => {
  const client = {
    attach: () =>
      Promise.resolve({
        output: [
          { sequence: 1, data: ' YQ==ignored', byteLength: 10 },
          { sequence: 2, data: '', byteLength: 0 },
          { sequence: 3, data: 'Pj4-Cg', byteLength: 1 }
        ],
        reconstructionComplete: false
      })
  } as unknown as AgentWorkspaceClient
  assert.deepEqual(await readTerminalText(client, randomUUID()), {
    text: 'a>>>\n',
    reconstructionComplete: false
  })
})

void test('terminal read preserves empty rows and final newlines when tailing', async () => {
  const cases = [
    ['', 1, ''],
    ['\n', 1, '\n'],
    ['\n\n', 1, '\n'],
    ['\n\n', 2, '\n\n'],
    ['first\n\nlast\n', 2, '\nlast\n'],
    ['\nlast', 1, 'last'],
    ['\nlast', Number.MAX_SAFE_INTEGER, '\nlast'],
    ['line\n'.repeat(10_000) + 'last', 2, 'line\nlast']
  ] as const
  const terminalId = randomUUID()
  for (const [replay, lines, expected] of cases) {
    const client = {
      attach: () =>
        Promise.resolve({
          output: replay ? [{ data: Buffer.from(replay).toString('base64') }] : [],
          reconstructionComplete: false
        })
    } as unknown as AgentWorkspaceClient
    assert.deepEqual(await readTerminalText(client, terminalId, lines), {
      text: expected,
      reconstructionComplete: false
    })
  }
})

void test('tab rename resolves its owning workspace and persists a custom title', async () => {
  const tabId = randomUUID()
  const workspaceId = randomUUID()
  const epoch = randomUUID()
  let request: unknown
  const client = {
    identify: () => Promise.resolve({ capabilities: ['tab.update'], idempotencyEpoch: epoch }),
    stateSnapshot: () =>
      Promise.resolve({
        snapshot: {
          revision: 12,
          workspaces: [{ id: workspaceId, tabs: { [tabId]: { id: tabId } } }]
        }
      }),
    updateTab: (params: unknown) => {
      request = params
      return Promise.resolve({ revision: 13 })
    }
  } as unknown as AgentWorkspaceClient
  const parsed = parseTerminalCommand(
    ['tab', 'rename', '--tab-id', tabId, '--title', 'Server logs'],
    '/private/session'
  )!
  assert.equal(parsed.command, 'tab.rename')
  assert.deepEqual(await renameTab(client, tabId, 'Server logs'), { revision: 13 })
  const sent = request as {
    workspaceId: string
    tabId: string
    customTitle: unknown
    expectedRevision: number
    idempotencyEpoch: string
  }
  assert.equal(sent.workspaceId, workspaceId)
  assert.equal(sent.tabId, tabId)
  assert.deepEqual(sent.customTitle, { value: 'Server logs' })
  assert.equal(sent.expectedRevision, 12)
  assert.equal(sent.idempotencyEpoch, epoch)
  await assert.rejects(renameTab(client, randomUUID(), 'Missing'), /Tab was not found/)
})
