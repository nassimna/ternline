import { EventEmitter } from 'node:events'

import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { BrowserAutomationDevtools } from './browser-automation-devtools'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
const encoder = vi.hoisted(() => ({
  initialize: vi.fn(() => Promise.resolve()),
  frame: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve(Buffer.from('webm'))),
  dispose: vi.fn()
}))
vi.mock('./browser-automation-recording', () => ({
  BrowserAutomationRecording: class {
    public readonly initialize = encoder.initialize
    public readonly frame = encoder.frame
    public readonly stop = encoder.stop
    public readonly dispose = encoder.dispose
    public constructor(
      public readonly width: number,
      public readonly height: number
    ) {}
  }
}))

function fixture(attached = false) {
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    sendCommand: vi.fn((method: string, params?: Record<string, unknown>) => {
      void method
      void params
      return Promise.resolve<unknown>({})
    })
  })
  const contents = {
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => 'https://example.test',
    getTitle: () => 'Example'
  } as unknown as WebContents
  const devtools = new BrowserAutomationDevtools(contents)
  const event = (method: string, params: unknown) => debuggerApi.emit('message', {}, method, params)
  const startRequest = (requestId: string) =>
    event('Network.requestWillBeSent', {
      requestId,
      timestamp: 1,
      request: { url: 'https://example.test/api', method: 'GET', headers: { fallback: 'yes' } }
    })
  return { debuggerApi, devtools, event, startRequest }
}

const bulkHeaders = Object.fromEntries(
  Array.from({ length: 7 }, (_, index) => [`bulk-${index}`, '🧪"\\\n'.repeat(114)])
)

describe('BrowserAutomationDevtools', () => {
  it('stops screencasting after encoder failure and ignores stale frame failures after detach', async () => {
    const own = fixture()
    await own.devtools.initialize()
    await own.devtools.run({ kind: 'recordingStart', width: 800, height: 600 })
    encoder.frame.mockRejectedValueOnce(new Error('Encoder failed'))
    own.event('Page.screencastFrame', { data: 'jpeg', sessionId: 1 })
    await vi.waitFor(() =>
      expect(own.debuggerApi.sendCommand).toHaveBeenCalledWith('Page.stopScreencast', undefined)
    )
    await expect(own.devtools.stopRecording()).rejects.toThrow('Encoder failed')
    expect(encoder.dispose).toHaveBeenCalledOnce()
    own.devtools.dispose()

    const detached = fixture()
    await detached.devtools.initialize()
    await detached.devtools.run({ kind: 'recordingStart', width: 800, height: 600 })
    let rejectFrame: ((error: Error) => void) | undefined
    encoder.frame.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFrame = reject
        })
    )
    detached.event('Page.screencastFrame', { data: 'jpeg', sessionId: 2 })
    detached.debuggerApi.emit('detach', {}, 'replaced_with_devtools')
    rejectFrame!(new Error('Destroyed encoder'))
    await new Promise((resolve) => setImmediate(resolve))
    await expect(detached.devtools.stopRecording()).rejects.toMatchObject({
      code: 'capability_unavailable'
    })
    expect(detached.debuggerApi.sendCommand).not.toHaveBeenCalledWith(
      'Page.stopScreencast',
      undefined
    )
    detached.devtools.dispose()
  })
  it('captures request redirects, timing, failures, cursor updates, and bounded response bodies', async () => {
    const { devtools, debuggerApi, event } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })
    event('Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 1,
      wallTime: 10,
      request: {
        url: 'https://example.test/old',
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    })
    event('Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 2,
      wallTime: 11,
      redirectResponse: { url: 'https://example.test/old', status: 302 },
      request: { url: 'https://example.test/api', method: 'GET', headers: {} }
    })
    event('Network.responseReceived', {
      requestId: 'r1',
      timestamp: 2.1,
      response: {
        url: 'https://example.test/api',
        status: 200,
        mimeType: 'application/json',
        headers: { 'content-type': 'application/json' }
      }
    })
    event('Network.loadingFinished', { requestId: 'r1', timestamp: 2.25, encodedDataLength: 123 })
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r1' })).toMatchObject({
      status: 200,
      durationMs: 250,
      complete: true,
      redirects: [{ status: 302 }]
    })
    const list = (await devtools.run({ kind: 'networkList', after: 3 })) as {
      requests: unknown[]
      cursor: number
    }
    expect(list.requests).toHaveLength(1)
    expect(list.cursor).toBe(4)
    debuggerApi.sendCommand.mockResolvedValueOnce({
      body: 'a'.repeat(100_000),
      base64Encoded: false
    })
    const body = (await devtools.run({ kind: 'networkBody', requestId: 'r1' })) as {
      body: string
      truncated: boolean
      byteLength: number
    }
    expect(body).toMatchObject({ truncated: true, byteLength: 100_000 })
    expect(Buffer.from(body.body, 'base64')).toHaveLength(45 * 1024)
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(64 * 1024)
    event('Network.requestWillBeSent', {
      requestId: 'r2',
      timestamp: 3,
      request: { url: 'https://example.test/fail', method: 'GET', headers: {} }
    })
    event('Network.loadingFailed', {
      requestId: 'r2',
      timestamp: 4,
      errorText: 'net::ERR_CONNECTION_REFUSED'
    })
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r2' })).toMatchObject({
      failure: 'net::ERR_CONNECTION_REFUSED',
      durationMs: 1000
    })
    await expect(devtools.run({ kind: 'networkBody', requestId: 'r2' })).rejects.toThrow(
      'unavailable'
    )
    await devtools.run({ kind: 'networkStop' })
    devtools.dispose()
    expect(debuggerApi.detach).toHaveBeenCalledOnce()
  })

  const bodyLimit = 45 * 1024
  const asciiBody = 'a'.repeat(bodyLimit)
  const unicodeBody = asciiBody.slice(1) + '🧪' + '界🧪'.repeat(bodyLimit) + '\uD800'
  const binaryBody = Buffer.alloc(bodyLimit + 1, 0xff)

  it.each([
    {
      name: 'ASCII at the exact byte limit',
      body: asciiBody,
      base64Encoded: false,
      decoded: Buffer.from(asciiBody)
    },
    {
      name: 'an emoji split by the byte limit and a long Unicode suffix',
      body: unicodeBody,
      base64Encoded: false,
      decoded: Buffer.from(unicodeBody)
    },
    {
      name: 'a large Base64 body with whitespace and padding',
      body: ' \n' + binaryBody.toString('base64') + '\t',
      base64Encoded: true,
      decoded: binaryBody
    }
  ])('preserves the response body bytes for $name', async ({ body, base64Encoded, decoded }) => {
    const { devtools, debuggerApi, event, startRequest } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })
    startRequest('r1')
    event('Network.loadingFinished', { requestId: 'r1', timestamp: 2 })
    debuggerApi.sendCommand.mockResolvedValueOnce({ body, base64Encoded })

    expect(await devtools.run({ kind: 'networkBody', requestId: 'r1' })).toEqual({
      body: decoded.subarray(0, bodyLimit).toString('base64'),
      base64Encoded: true,
      truncated: decoded.length > bodyLimit,
      byteLength: decoded.length
    })
    devtools.dispose()
  })

  it('evicts the oldest request when a retained update exceeds the JSON byte cap', async () => {
    const { devtools, event } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })

    const url = 'https://example.test/api'
    const requestIds = Array.from({ length: 8 }, (_, index) => `r${index + 1}`)
    for (const requestId of requestIds) {
      event('Network.requestWillBeSent', {
        requestId,
        timestamp: 1,
        request: { url, method: 'GET', headers: {} }
      })
    }
    const list = async () =>
      (await devtools.run({ kind: 'networkList' })) as {
        requests: Array<{ requestId: string; sequence: number }>
        cursor: number
        dropped: number
      }
    const { requests } = await list()
    const response = { url, status: 200, mimeType: '🧪"\\\n', headers: {} }
    const atLimit = [
      ...requests.slice(0, -1),
      {
        ...requests.at(-1),
        sequence: 9,
        status: response.status,
        mimeType: response.mimeType,
        responseHeaders: response.headers
      }
    ]
    response.mimeType += 'a'.repeat(48 * 1024 - Buffer.byteLength(JSON.stringify(atLimit)))
    event('Network.responseReceived', { requestId: 'r8', timestamp: 2, response })

    const full = await list()
    expect(full.requests.map((request) => request.requestId)).toEqual(requestIds)
    expect(full).toMatchObject({ cursor: 9, dropped: 0 })
    expect(Buffer.byteLength(JSON.stringify(full.requests))).toBe(48 * 1024)

    // A response without a payload grows the sequence by a digit but defers pruning.
    event('Network.responseReceived', { requestId: 'r2', timestamp: 2 })
    const over = await list()
    expect(over.requests.map((request) => request.requestId)).toEqual(requestIds)
    expect(over).toMatchObject({ cursor: 10, dropped: 0 })
    expect(Buffer.byteLength(JSON.stringify(over.requests))).toBe(48 * 1024 + 1)

    // Offset r8's extra sequence digit so only the previous event contributes to the overflow.
    response.mimeType = response.mimeType.slice(0, -1)
    event('Network.responseReceived', { requestId: 'r8', timestamp: 2, response })
    const pruned = await list()
    expect(pruned.requests.map((request) => request.requestId)).toEqual(requestIds.slice(1))
    expect(pruned).toMatchObject({ cursor: 11, dropped: 1 })
    await expect(devtools.run({ kind: 'networkGet', requestId: 'r1' })).rejects.toThrow(
      'Network request is not retained'
    )
    devtools.dispose()
  })

  it.each([0, 1])('applies the pending header byte cap at 48 KiB plus %i bytes', async (over) => {
    const { devtools, event, startRequest } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })

    const tail = { boundary: '🧪"\\\n' }
    const entries = [...Array.from({ length: 6 }, () => bulkHeaders), tail]
    tail.boundary += 'a'.repeat(48 * 1024 + over - Buffer.byteLength(JSON.stringify(entries)))
    expect(Buffer.byteLength(JSON.stringify(entries))).toBe(48 * 1024 + over)

    event('Network.requestWillBeSentExtraInfo', { requestId: 'r0', headers: { old: 'value' } })
    for (const [index, headers] of entries.entries()) {
      if (index > 0)
        event('Network.requestWillBeSentExtraInfo', { requestId: `r${index}`, headers })
    }
    event('Network.requestWillBeSentExtraInfo', { requestId: 'r0', headers: bulkHeaders })

    startRequest('r0')
    startRequest('r1')
    startRequest('r6')
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r0' })).toMatchObject({
      requestHeaders: over ? { fallback: 'yes' } : bulkHeaders
    })
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r1' })).toMatchObject({
      requestHeaders: bulkHeaders
    })
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r6' })).toMatchObject({
      requestHeaders: tail
    })
    devtools.dispose()
  })

  it('releases the pending bytes for both sides when a request starts', async () => {
    const { devtools, event, startRequest } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })

    for (let index = 0; index < 4; index++) {
      event('Network.requestWillBeSentExtraInfo', { requestId: `r${index}`, headers: bulkHeaders })
    }
    event('Network.requestWillBeSentExtraInfo', { requestId: 'both', headers: bulkHeaders })
    const responseHeaders = { ...bulkHeaders, side: 'response' }
    event('Network.responseReceivedExtraInfo', { requestId: 'both', headers: responseHeaders })
    startRequest('both')
    expect(await devtools.run({ kind: 'networkGet', requestId: 'both' })).toMatchObject({
      requestHeaders: bulkHeaders,
      responseHeaders
    })

    for (const requestId of ['r4', 'r5']) {
      event('Network.requestWillBeSentExtraInfo', { requestId, headers: bulkHeaders })
    }
    startRequest('r0')
    expect(await devtools.run({ kind: 'networkGet', requestId: 'r0' })).toMatchObject({
      requestHeaders: bulkHeaders
    })
    devtools.dispose()
  })

  it('limits pending request and response headers to 100 entries combined', async () => {
    const { devtools, event, startRequest } = fixture()
    await devtools.initialize()
    await devtools.run({ kind: 'networkStart' })

    const headers = { pending: 'yes' }
    event('Network.requestWillBeSentExtraInfo', { requestId: 'both', headers })
    event('Network.responseReceivedExtraInfo', { requestId: 'both', headers })
    for (let index = 0; index < 99; index++) {
      event('Network.requestWillBeSentExtraInfo', { requestId: `r${index}`, headers })
    }
    startRequest('both')
    expect(await devtools.run({ kind: 'networkGet', requestId: 'both' })).toMatchObject({
      requestHeaders: { fallback: 'yes' },
      responseHeaders: headers
    })
    devtools.dispose()
  })

  it.each([0, 1])(
    'keeps the longest request header prefix at 8192 plus %i bytes',
    async (extra) => {
      const { devtools, event } = fixture()
      await devtools.initialize()
      await devtools.run({ kind: 'networkStart' })

      const prefix = Array.from({ length: 7 }, (_, index): [string, string] => [
        `header-${index}`,
        'a'.repeat(1024)
      ])
      const last: [string, string] = ['boundary', '🧪"\\\n']
      const padding = 8192 - Buffer.byteLength(JSON.stringify([...prefix, last]))
      last[1] += 'a'.repeat(padding + extra)
      expect(Buffer.byteLength(JSON.stringify([...prefix, last]))).toBe(8192 + extra)

      event('Network.requestWillBeSent', {
        requestId: 'r1',
        timestamp: 1,
        request: {
          url: 'https://example.test/api',
          method: 'GET',
          headers: Object.fromEntries([...prefix, last, ['small', 'x']])
        }
      })
      const request = (await devtools.run({ kind: 'networkGet', requestId: 'r1' })) as {
        requestHeaders: Record<string, string>
      }
      expect(request.requestHeaders).toEqual(Object.fromEntries(extra ? prefix : [...prefix, last]))
      devtools.dispose()
    }
  )

  it('retains structured diagnostics with stacks, bounds, filters, cursors, and clearing', async () => {
    const { devtools, event } = fixture()
    await devtools.initialize()
    for (let index = 0; index < 105; index++) {
      event('Runtime.consoleAPICalled', {
        type: 'log',
        args: [
          { type: 'string', value: `message ${index}` },
          { type: 'number', value: index }
        ],
        timestamp: index,
        stackTrace: {
          callFrames: [
            {
              functionName: 'log',
              url: 'https://example.test/app.js',
              lineNumber: 2,
              columnNumber: 1
            }
          ]
        }
      })
    }
    const diagnostics = devtools.diagnostics('console', false, 103, 'info')
    expect(diagnostics.entries).toHaveLength(2)
    expect(devtools.diagnostics('console', false).dropped).toBe(5)
    expect(diagnostics).toMatchObject({ cursor: 105, dropped: 0 })
    expect(diagnostics.entries[0]).toMatchObject({
      line: 3,
      args: [{ value: 'message 103' }, { value: 103 }],
      stack: 'at log (https://example.test/app.js:3:2)'
    })
    event('Runtime.exceptionThrown', {
      timestamp: 200,
      exceptionDetails: {
        text: 'Uncaught',
        lineNumber: 3,
        exception: { type: 'object', description: 'Error: failed' },
        stackTrace: {
          callFrames: [
            {
              functionName: 'run',
              url: 'https://example.test/app.js',
              lineNumber: 3,
              columnNumber: 0
            }
          ]
        }
      }
    })
    expect(devtools.diagnostics('errors', true).entries[0]).toMatchObject({
      message: 'Error: failed',
      source: 'https://example.test/app.js',
      line: 4
    })
    expect(devtools.diagnostics('errors', false).entries).toEqual([])
    devtools.dispose()
  })

  it.each([
    { name: 'escaped oversized string', value: '"\\\n\u0000'.repeat(1024), truncated: true },
    { name: 'surrogate pair split in output', value: 'x'.repeat(2046) + '🧪xx', truncated: true },
    {
      name: 'surrogate pair split by input slice',
      value: 'x'.repeat(2047) + '🧪xx',
      truncated: true
    },
    { name: 'string at 2048 UTF-8 bytes', value: 'é'.repeat(1023), truncated: false },
    { name: 'string at 2049 UTF-8 bytes', value: 'é'.repeat(1023) + 'x', truncated: true },
    { name: 'small object', value: { nested: [true, null, 7] }, truncated: false },
    { name: 'oversized object', value: { text: 'x'.repeat(2048) }, truncated: true }
  ])('preserves the console argument JSON boundary for $name', async ({ value, truncated }) => {
    const { devtools, event } = fixture()
    await devtools.initialize()
    const type = typeof value
    event('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1,
      args: [{ type, preview: value, value }]
    })

    const expected = truncated ? JSON.stringify(value).slice(0, 2048) : value
    expect(devtools.diagnostics('console', false)).toMatchObject({
      entries: [
        {
          args: [{ type, preview: expected, value: expected }],
          message: typeof expected === 'string' ? expected : JSON.stringify(expected)
        }
      ],
      cursor: 1,
      dropped: 0
    })
    devtools.dispose()
  })

  it.each([0, 1])('enforces the JSON byte cap with %i bytes over the limit', async (over) => {
    const { devtools, event } = fixture()
    await devtools.initialize()
    const preview = 'é"\n'.repeat(330)
    const args = Array.from({ length: 12 }, () => ({ type: 'object', preview }))
    event('Runtime.consoleAPICalled', { type: 'log', timestamp: 1, args })
    const [first] = devtools.diagnostics('console', false).entries
    event('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1,
      args: [...args, { type: 'object', preview: 'x'.repeat(505 + over) }]
    })
    const result = devtools.diagnostics('console', false)
    expect(result.entries.map((entry) => entry.sequence)).toEqual(over ? [2] : [1, 2])
    expect(result).toMatchObject({ cursor: 2, dropped: over })
    expect(Buffer.byteLength(JSON.stringify([first, result.entries.at(-1)]))).toBe(48 * 1024 + over)

    event('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1,
      args: args.map((arg) => ({ ...arg, description: 'é'.repeat(2048) }))
    })
    expect(devtools.diagnostics('console', false, 1)).toEqual({
      entries: [],
      cursor: 3,
      dropped: 2
    })
    devtools.dispose()
  })

  it('clears diagnostic bytes while preserving each stream’s cursor and dropped sequence', async () => {
    const { devtools, event } = fixture()
    await devtools.initialize()
    const consoleEvent = {
      type: 'log',
      timestamp: 1,
      args: Array.from({ length: 9 }, () => ({ type: 'object', description: 'é'.repeat(2048) }))
    }
    const errorEvent = {
      timestamp: 1,
      exceptionDetails: { text: '界'.repeat(4096), url: '界'.repeat(2048), lineNumber: 0 }
    }
    for (let index = 0; index < 3; index++) {
      event('Runtime.consoleAPICalled', consoleEvent)
      event('Runtime.exceptionThrown', errorEvent)
    }

    const clearedConsole = devtools.diagnostics('console', true)
    expect(clearedConsole.entries.map((entry) => entry.sequence)).toEqual([3])
    expect(clearedConsole).toMatchObject({ cursor: 3, dropped: 2 })
    expect(devtools.diagnostics('console', false)).toEqual({ entries: [], cursor: 3, dropped: 2 })
    expect(devtools.diagnostics('errors', false).entries.map((entry) => entry.sequence)).toEqual([
      2, 3
    ])
    const clearedErrors = devtools.diagnostics('errors', true, 2)
    expect(clearedErrors.entries.map((entry) => entry.sequence)).toEqual([3])
    expect(clearedErrors).toMatchObject({ cursor: 3, dropped: 0 })
    expect(devtools.diagnostics('errors', false)).toEqual({ entries: [], cursor: 3, dropped: 1 })

    event('Runtime.consoleAPICalled', consoleEvent)
    event('Runtime.exceptionThrown', errorEvent)
    expect(devtools.diagnostics('console', false)).toEqual({
      entries: [{ ...clearedConsole.entries[0], sequence: 4 }],
      cursor: 4,
      dropped: 2
    })
    expect(devtools.diagnostics('errors', false)).toEqual({
      entries: [{ ...clearedErrors.entries[0], sequence: 4 }],
      cursor: 4,
      dropped: 1
    })
    devtools.dispose()
  })

  it('exposes semantic backend nodes and emulates appearance', async () => {
    const { devtools, debuggerApi } = fixture()
    await devtools.initialize()
    debuggerApi.sendCommand.mockResolvedValueOnce({
      nodes: [
        { nodeId: '1', ignored: true },
        {
          nodeId: '2',
          parentId: '1',
          ignored: false,
          role: { value: 'button' },
          name: { value: 'Submit' },
          backendDOMNodeId: 42,
          properties: [{ name: 'disabled', value: { value: false } }]
        }
      ]
    })
    expect(await devtools.run({ kind: 'snapshot' })).toMatchObject({
      nodes: [{ role: 'button', name: 'Submit', backendDOMNodeId: 42 }],
      truncated: false
    })
    await devtools.run({ kind: 'appearance', colorScheme: 'dark' })
    expect(debuggerApi.sendCommand).toHaveBeenLastCalledWith('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }]
    })
    await devtools.run({ kind: 'appearance', colorScheme: 'system' })
    expect(debuggerApi.sendCommand).toHaveBeenLastCalledWith('Emulation.setEmulatedMedia', {
      features: []
    })
    devtools.dispose()
  })

  it('retains the longest snapshot prefix within 48 KiB of serialized UTF-8', async () => {
    const { devtools, debuggerApi } = fixture()
    await devtools.initialize()
    const prefix = Array.from({ length: 23 }, (_, index) => ({
      nodeId: String(index),
      role: '',
      name: 'a'.repeat(2048)
    }))
    const last = { nodeId: 'last', role: '', name: '🧪"\\\n' }
    last.name += 'a'.repeat(48 * 1024 - Buffer.byteLength(JSON.stringify([...prefix, last])))
    const cdpPrefix = prefix.map(({ nodeId, name }) => ({ nodeId, name: { value: name } }))
    const cdpLast = { nodeId: last.nodeId, name: { value: last.name } }

    debuggerApi.sendCommand.mockResolvedValueOnce({ nodes: [...cdpPrefix, cdpLast] })
    const snapshot = (await devtools.run({ kind: 'snapshot' })) as {
      nodes: unknown[]
      truncated: boolean
    }
    expect(snapshot).toMatchObject({ nodes: [...prefix, last], truncated: false })
    expect(Buffer.byteLength(JSON.stringify(snapshot.nodes))).toBe(48 * 1024)

    debuggerApi.sendCommand.mockResolvedValueOnce({
      nodes: [...cdpPrefix, { nodeId: 'over', name: { value: last.name + 'a' } }, cdpLast]
    })
    expect(await devtools.run({ kind: 'snapshot' })).toMatchObject({
      nodes: prefix,
      truncated: true
    })
    devtools.dispose()
  })

  it.each([false, true])(
    'truncates at 200 eligible nodes only if another is present (%s)',
    async (extra) => {
      const { devtools, debuggerApi } = fixture()
      await devtools.initialize()
      const nodes = Array.from({ length: 200 }, (_, index) => ({ nodeId: String(index) }))
      debuggerApi.sendCommand.mockResolvedValueOnce({
        nodes: [
          ...nodes,
          { nodeId: 'ignored', ignored: true },
          ...(extra ? [{ nodeId: 'extra' }] : [])
        ]
      })
      expect(await devtools.run({ kind: 'snapshot' })).toMatchObject({ nodes, truncated: extra })
      devtools.dispose()
    }
  )

  it('does not steal debugger ownership and reports capability loss after detachment', async () => {
    const busy = fixture(true)
    await expect(busy.devtools.initialize()).rejects.toThrow('already owned')
    busy.devtools.dispose()
    expect(busy.debuggerApi.detach).not.toHaveBeenCalled()
    const own = fixture()
    await own.devtools.initialize()
    own.debuggerApi.emit('detach', {}, 'replaced_with_devtools')
    await expect(own.devtools.command('Network.enable')).rejects.toMatchObject({
      code: 'capability_unavailable'
    })
    expect(() => own.devtools.diagnostics('console', false)).toThrow('unavailable')
    own.devtools.dispose()
    expect(own.debuggerApi.detach).not.toHaveBeenCalled()
  })
})
