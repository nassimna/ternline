import { randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { ApplicationStateStore } from '../persistence/application-state-store'
import { EncryptedIndex } from './encrypted-index'
import { EncryptedVaultSearch } from './encrypted-vault-search'
import { FilesService } from './files-service'

it('pages past stale matches and reports whether another accessible result exists', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'node-encrypted-search-pages-'))
  chmodSync(parent, 0o700)
  const root = join(parent, 'root')
  mkdirSync(root)
  writeFileSync(join(root, 'first.txt'), 'needle first')
  writeFileSync(join(root, 'second.txt'), 'needle second')
  const source = randomUUID()
  const listAgentCatalog = vi.fn()
  const state = {
    listAgentCatalog,
    readSnapshot: () => ({ workspaces: [{ id: source, name: 'Fixture', workingDirectory: root }] }),
    getAgentSession: () => {
      throw new Error('No agent session')
    }
  } as unknown as ApplicationStateStore
  const files = new FilesService(state)
  const index = EncryptedIndex.open(parent, Buffer.alloc(32, 7))
  const search = new EncryptedVaultSearch(index, files, state)
  try {
    search.policy({
      sourceAuthorizationId: source,
      sourceKind: 'workspaceFile',
      retentionDays: 30,
      exclusionIds: [],
      mutation: { expectedRevision: 1 }
    })
    const descriptor = files.listRoots({ limit: 64 }).roots[0]!
    const entries = files.listDirectory({
      directoryDescriptorId: descriptor.directoryDescriptorId,
      generation: descriptor.generation,
      limit: 100,
      cancellationId: randomUUID()
    }).entries
    const documents = entries.map(
      (entry) =>
        files.issueDocument({
          authorizedDescriptorId: entry.entryDescriptorId,
          descriptorGeneration: entry.generation,
          expectedKind: 'plainText'
        }).document
    )
    const now = Date.now()
    const options = (indexedAtMs: number) => ({
      maxBytes: 1024,
      deadlineMs: Date.now() + 10_000,
      indexedAtMs
    })
    index.indexText(source, documents[0]!, 'workspaceFile', 'needle first', options(now - 1))
    index.indexText(source, documents[1]!, 'workspaceFile', 'needle second', options(now - 2))
    for (let number = 0; number < 101; number++) {
      index.indexText(
        source,
        { documentId: randomUUID(), identityVersion: 1 },
        'workspaceFile',
        'needle stale',
        options(now + 1)
      )
    }
    const query = (limit: number) =>
      search.query({
        query: 'needle',
        limit,
        cancellationId: randomUUID(),
        sourceAuthorizationIds: [source]
      })
    expect(await query(1)).toMatchObject({
      results: [{ document: documents[0] }],
      truncated: true
    })
    expect(await query(2)).toMatchObject({
      results: [{ document: documents[0] }, { document: documents[1] }],
      truncated: false
    })
    writeFileSync(join(root, 'second.txt'), 'changed')
    expect(await query(1)).toMatchObject({
      results: [{ document: documents[0] }],
      truncated: false
    })
    await expect(query(0)).rejects.toMatchObject({ code: 'resource_limit' })
    expect(listAgentCatalog).not.toHaveBeenCalled()
  } finally {
    search.close()
    files.close()
    rmSync(parent, { recursive: true, force: true })
  }
})

it('reuses successful transcript validation per page and retries a failed lookup', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'node-encrypted-search-catalog-'))
  const source = randomUUID()
  const document = () => ({ documentId: randomUUID(), identityVersion: 1 })
  const first = document()
  const second = document()
  const third = document()
  const stale = document()
  const wrongAdapter = document()
  const wrongVersion = document()
  const missing = document()
  const session = ({ documentId, identityVersion }: ReturnType<typeof document>) => ({
    binding: { agentSessionId: documentId },
    adapterId: 'codex',
    adapterVersion: '0.142.4',
    revision: identityVersion
  })
  const sessions = [
    session(first),
    session(second),
    session(third),
    { ...session(stale), revision: 2 },
    { ...session(wrongAdapter), adapterId: 'other' },
    { ...session(wrongVersion), adapterVersion: '0.142.3' }
  ]
  const listAgentCatalog = vi.fn(() => ({ sessions }))
  const getAgentSession = vi.fn((id: string) => {
    const catalog = listAgentCatalog()
    const session = catalog.sessions.find((entry) => entry.binding.agentSessionId === id)
    if (!session) throw new Error('No agent session')
    return { session }
  })
  const state = { listAgentCatalog, getAgentSession } as unknown as ApplicationStateStore
  const files = new FilesService(state)
  const index = EncryptedIndex.open(parent, Buffer.alloc(32, 7))
  const search = new EncryptedVaultSearch(index, files, state)
  try {
    index.authorizeSource(source)
    const now = Date.now()
    const documents = [
      first,
      stale,
      wrongAdapter,
      wrongVersion,
      missing,
      second,
      ...Array.from({ length: 94 }, document),
      third
    ]
    for (const [position, document] of documents.entries()) {
      index.indexText(source, document, 'agentTranscript', 'needle', {
        maxBytes: 1024,
        deadlineMs: now + 10_000,
        indexedAtMs: now - position
      })
    }
    const query = (limit: number) =>
      search.query({ query: 'needle', limit, cancellationId: randomUUID() })

    expect(await query(2)).toMatchObject({
      results: [{ document: first }, { document: second }],
      truncated: true
    })
    expect(await query(3)).toMatchObject({
      results: [{ document: first }, { document: second }, { document: third }],
      truncated: false
    })

    listAgentCatalog.mockImplementationOnce(() => {
      throw new Error('Agent catalog unavailable')
    })
    expect(await query(2)).toMatchObject({
      results: [{ document: second }, { document: third }],
      truncated: false
    })
    expect(listAgentCatalog.mock.calls).toEqual(Array(7).fill([{ catalogVersion: 1 }]))
    expect(getAgentSession).not.toHaveBeenCalled()
  } finally {
    search.close()
    files.close()
    rmSync(parent, { recursive: true, force: true })
  }
})
