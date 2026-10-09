import { describe, expect, it, vi } from 'vitest'

import { moveNodeBrowserTab } from './node-tab-browser-move'

function fixture() {
  const events: string[] = []
  const resume = vi.fn(() => events.push('resume'))
  const source = {
    suspendOwnedSession: vi.fn(() => {
      events.push('suspend')
      return resume
    }),
    destroyOwnedSession: vi.fn(() => events.push('destroy-source'))
  }
  const target = {
    ownsSession: vi.fn(() => false),
    mountTransferred: vi.fn(() => {
      events.push('mount-target')
      return Promise.resolve()
    }),
    destroyOwnedSession: vi.fn(() => events.push('destroy-target')),
    activateTransferredSession: vi.fn(() => events.push('activate-target'))
  }
  const commit = vi.fn(() => {
    events.push('commit')
    return Promise.resolve()
  })
  const transferred = vi.fn(() => events.push('record-owner'))
  const input = {
    source,
    target,
    descriptor: {
      workspaceId: 'source-workspace',
      paneId: 'source-pane',
      tabId: 'tab',
      browserSessionId: 'browser',
      lifecycleId: 'lifecycle',
      profilePartition: 'persist:test',
      stateRevision: 3,
      title: 'Page',
      url: 'https://example.test',
      history: { entries: [{ url: 'https://example.test', title: 'Page' }], index: 0 }
    },
    destination: { workspaceId: 'target-workspace', paneId: 'target-pane' },
    targetSnapshot: undefined,
    assertCurrent: vi.fn(),
    commit,
    resolveCommit: vi.fn((): Promise<'committed' | 'not-committed' | 'unknown'> =>
      Promise.resolve('not-committed')
    ),
    transferred
  }
  return { events, resume, source, target, commit, transferred, input }
}

describe('Node exact browser tab move', () => {
  it('stages destination and preserves navigation history before durable commit', async () => {
    const test = fixture()
    await moveNodeBrowserTab(test.input)
    expect(test.target.mountTransferred).toHaveBeenCalledWith(
      {
        ...test.input.descriptor,
        ...test.input.destination
      },
      undefined
    )
    expect(test.events).toEqual([
      'suspend',
      'mount-target',
      'commit',
      'activate-target',
      'destroy-source',
      'record-owner'
    ])
    expect(test.resume).not.toHaveBeenCalled()
  })

  it('restores source on mount failure or proven rejected commit', async () => {
    const mount = fixture()
    mount.target.mountTransferred.mockRejectedValueOnce(new Error('mount failed'))
    await expect(moveNodeBrowserTab(mount.input)).rejects.toThrow('mount failed')
    expect(mount.events).toEqual(['suspend', 'destroy-target', 'resume'])

    const rejected = fixture()
    rejected.commit.mockRejectedValueOnce(new Error('stale revision'))
    await expect(moveNodeBrowserTab(rejected.input)).rejects.toThrow('stale revision')
    expect(rejected.events).toEqual(['suspend', 'mount-target', 'destroy-target', 'resume'])
  })

  it('preserves a non-Error commit failure as the cause after finalizing ownership', async () => {
    const test = fixture()
    test.commit.mockRejectedValueOnce('lost response')
    test.input.resolveCommit.mockResolvedValueOnce('committed')
    await expect(moveNodeBrowserTab(test.input)).rejects.toMatchObject({
      message: 'The Node tab move failed',
      cause: 'lost response'
    })
    expect(test.transferred).toHaveBeenCalledWith('browser')
  })

  it('finalizes a proven commit and quarantines an unknown outcome', async () => {
    const committed = fixture()
    committed.commit.mockRejectedValueOnce(new Error('lost response'))
    committed.input.resolveCommit.mockResolvedValueOnce('committed')
    await expect(moveNodeBrowserTab(committed.input)).rejects.toThrow('lost response')
    expect(committed.events).toEqual([
      'suspend',
      'mount-target',
      'activate-target',
      'destroy-source',
      'record-owner'
    ])

    const unknown = fixture()
    unknown.commit.mockRejectedValueOnce(new Error('lost response'))
    unknown.input.resolveCommit.mockResolvedValueOnce('unknown')
    await expect(moveNodeBrowserTab(unknown.input)).rejects.toThrow('quarantined')
    expect(unknown.events).toEqual(['suspend', 'mount-target'])
  })
})
