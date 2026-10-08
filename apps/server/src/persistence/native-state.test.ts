import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ApplicationStateStore } from './application-state-store'

describe('native Node profile', () => {
  it('commits, reopens, edits and clears a saved SSH workspace', async () => {
    const cache = join(homedir(), '.cache')
    mkdirSync(cache, { recursive: true })
    const root = mkdtempSync(join(cache, 'ternline-ssh-state-test-'))
    const database = join(root, 'state.sqlite')
    const backup = join(root, 'backup.sqlite')
    let store: ApplicationStateStore | undefined
    try {
      store = await ApplicationStateStore.openNative(database, backup, root)
      const ssh = {
        host: 'prod-alias',
        user: 'deploy',
        port: 2222,
        identityFile: '/home/alex/.ssh/key'
      }
      const ids = { workspaceId: randomUUID(), paneId: randomUUID(), tabId: randomUUID() }
      const identity = () => ({
        expectedRevision: store!.readSnapshot().revision,
        idempotencyEpoch: store!.currentIdempotencyEpoch(),
        idempotencyKey: randomUUID()
      })
      const request = {
        name: 'SSH',
        workingDirectory: root,
        ssh,
        initialTerminal: { cwd: root, rows: 24, cols: 80 },
        ...identity()
      }
      expect(store.preflightWorkspaceCreate(request, ids, 2)).toBeNull()
      store.commitWorkspaceCreate(request, ids, 2)
      expect(
        store.readSnapshot().workspaces.find((item) => item.id === ids.workspaceId)?.ssh
      ).toEqual(ssh)
      store.close()
      store = await ApplicationStateStore.openNative(database, backup, root)
      expect(
        store.readSnapshot().workspaces.find((item) => item.id === ids.workspaceId)?.ssh
      ).toEqual(ssh)
      const edited = { host: 'other-host', user: '', port: 22 }
      store.updateWorkspace({ workspaceId: ids.workspaceId, ssh: { value: edited }, ...identity() })
      expect(
        store.readSnapshot().workspaces.find((item) => item.id === ids.workspaceId)?.ssh
      ).toEqual(edited)
      store.updateWorkspace({ workspaceId: ids.workspaceId, ssh: { value: null }, ...identity() })
      expect(
        store.readSnapshot().workspaces.find((item) => item.id === ids.workspaceId)?.ssh
      ).toBeUndefined()
    } finally {
      store?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates a valid durable workspace and reopens it without replacing the database', async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'agent-workspace-native-test-'))
    try {
      const path = join(root, 'state.sqlite')
      const backup = join(root, 'pre-node.sqlite')
      const initial = await ApplicationStateStore.openNative(path, backup, root)
      const snapshot = initial.readSnapshot()
      expect(snapshot.workspaces).toHaveLength(1)
      expect(snapshot.selectedWorkspaceId).toBe(snapshot.workspaces[0]?.id)
      initial.close()
      const reopened = await ApplicationStateStore.openNative(path, backup, root)
      expect(reopened.readSnapshot()).toEqual(snapshot)
      reopened.close()
      expect(existsSync(backup)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
