import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'

import { ApplicationStateStore } from '../persistence/application-state-store'
import { ContentCatalog, type SidebarPlacement } from './content-catalog'
import { ContentMutations } from './content-mutations'

it('preserves a complete sidebar order and rejects malformed orders on write and read', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'ternline-sidebar-test-'))
  let state: ApplicationStateStore | undefined
  let catalog: ContentCatalog | undefined
  let mutations: ContentMutations | undefined
  let database: Database.Database | undefined
  try {
    const databasePath = join(root, 'workspace.sqlite')
    state = await ApplicationStateStore.openNative(databasePath, join(root, 'backup.sqlite'), root)
    const windowId = state.readSnapshot().windowPlacements[0]!.id
    catalog = new ContentCatalog(databasePath)
    mutations = new ContentMutations(databasePath)
    const placement: SidebarPlacement = {
      windowId,
      revision: 1,
      side: 'right',
      width: 360,
      enabled: ['search', 'textBox'],
      order: [
        'search',
        'files',
        'recentlyClosed',
        'diff',
        'textBox',
        'markdown',
        'vault',
        'taskManager'
      ],
      selected: 'search'
    }
    expect(
      mutations.saveSidebarPlacement({
        placement,
        mutation: { idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), expectedRevision: 0 }
      })
    ).toStrictEqual(placement)
    expect(catalog.getSidebarPlacement(windowId)).toStrictEqual(placement)
    expect(catalog.listSidebarPlacements()).toStrictEqual({ placements: [placement] })

    const incompleteOrder = placement.order.slice(0, -1)
    const malformedOrders = [
      incompleteOrder,
      [...incompleteOrder, placement.order[0]],
      [...incompleteOrder, 'unknown']
    ]
    for (const order of malformedOrders) {
      expect(() =>
        mutations!.saveSidebarPlacement({
          placement: { ...placement, revision: 2, order: order as SidebarPlacement['order'] },
          mutation: {
            idempotencyKey: randomUUID(),
            requestHash: 'b'.repeat(64),
            expectedRevision: 1
          }
        })
      ).toThrow(
        expect.objectContaining({ code: 'invalid_params', message: 'Invalid sidebar placement' })
      )
      expect(catalog.getSidebarPlacement(windowId)).toStrictEqual(placement)
    }

    database = new Database(databasePath, { fileMustExist: true })
    const updateOrder = database.prepare(
      'UPDATE sidebar_placements SET order_json = ? WHERE window_id = ?'
    )
    const corruptOrder = { code: 'corrupt_content', message: 'Stored content is invalid' }
    for (const order of malformedOrders) {
      expect(updateOrder.run(JSON.stringify(order), windowId).changes).toBe(1)
      expect(() => catalog!.getSidebarPlacement(windowId)).toThrow(
        expect.objectContaining(corruptOrder)
      )
      expect(() => catalog!.listSidebarPlacements()).toThrow(expect.objectContaining(corruptOrder))
    }
  } finally {
    database?.close()
    mutations?.close()
    catalog?.close()
    state?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it('returns the saved TextBox document from the catalog and on deletion', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'ternline-textbox-test-'))
  let state: ApplicationStateStore | undefined
  let catalog: ContentCatalog | undefined
  let mutations: ContentMutations | undefined
  const createdAtMs = 1_750_000_000_000
  const updatedAtMs = createdAtMs + 500
  const clock = vi.spyOn(Date, 'now')
  try {
    const databasePath = join(root, 'workspace.sqlite')
    state = await ApplicationStateStore.openNative(databasePath, join(root, 'backup.sqlite'), root)
    const snapshot = state.readSnapshot()
    const windowId = snapshot.windowPlacements[0]!.id
    const { workspaceId } = state.commitWorkspaceCreate(
      {
        windowId,
        name: 'Notes workspace',
        workingDirectory: root,
        initialTerminal: { cwd: root, rows: 24, cols: 80 },
        expectedRevision: snapshot.revision,
        idempotencyEpoch: state.currentIdempotencyEpoch(),
        idempotencyKey: randomUUID()
      },
      { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() },
      createdAtMs
    )
    catalog = new ContentCatalog(databasePath)
    mutations = new ContentMutations(databasePath)
    const textBoxDocumentId = randomUUID()
    const created = {
      textBoxDocumentId,
      workspaceId,
      windowId,
      title: 'Draft',
      text: 'First line',
      contentRevision: 1,
      createdAtMs,
      updatedAtMs: createdAtMs
    }
    const saved = {
      ...created,
      title: 'Release notes',
      text: 'First line\nSecond line',
      contentRevision: 2,
      updatedAtMs
    }

    clock.mockReturnValue(createdAtMs)
    expect(
      mutations.createTextBox({
        textBoxDocumentId,
        workspaceId,
        windowId,
        title: created.title,
        text: created.text,
        mutation: { idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), expectedRevision: 0 }
      })
    ).toStrictEqual(created)

    clock.mockReturnValue(updatedAtMs)
    expect(
      mutations.saveTextBox({
        textBoxDocumentId,
        expectedRevision: 1,
        title: saved.title,
        text: saved.text,
        mutation: { idempotencyKey: randomUUID(), requestHash: 'b'.repeat(64), expectedRevision: 1 }
      })
    ).toStrictEqual(saved)
    expect(catalog.getTextBox(textBoxDocumentId)).toStrictEqual(saved)
    expect(catalog.listTextBoxes({ limit: 1 })).toStrictEqual({
      documents: [saved],
      nextCursor: null
    })

    clock.mockReturnValue(updatedAtMs + 500)
    expect(
      mutations.deleteTextBox({
        textBoxDocumentId,
        expectedRevision: 2,
        mutation: { idempotencyKey: randomUUID(), requestHash: 'c'.repeat(64), expectedRevision: 2 }
      })
    ).toStrictEqual(saved)
    expect(() => catalog!.getTextBox(textBoxDocumentId)).toThrow('TextBox not found')
  } finally {
    clock.mockRestore()
    mutations?.close()
    catalog?.close()
    state?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
