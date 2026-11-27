import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'
import { expect, it } from 'vitest'

import { AgentCatalog } from './agent-catalog'
import { NATIVE_SCHEMA_SQL } from './native-schema'

it('validates shared parent chains and rejects invalid parents when listing the catalog', () => {
  const database = new Database(':memory:')
  try {
    database.exec(NATIVE_SCHEMA_SQL)
    database.exec('INSERT INTO agent_catalog_state (singleton, revision) VALUES (1, 0)')
    const otherTeam = randomUUID()
    const team = randomUUID()
    const insertTeam = database.prepare('INSERT INTO agent_teams VALUES (?, ?, 1, ?, ?)')
    insertTeam.run(otherTeam, 'Other team', 0, 0)
    insertTeam.run(team, 'Team', 1, 1)

    const insertSession = database.prepare(`
      INSERT INTO agent_sessions (
        agent_session_id, workspace_id, pane_id, tab_id, adapter_id, adapter_version,
        title, lifecycle, durable_intent, restore_level, revision, attempt_epoch,
        evidence_epoch, last_verified_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'codex', '1', 'Session', 'running', 'none', 'toolResume',
        1, 1, 1, 0, 0, 0)
    `)
    const insertMember = database.prepare(`
      INSERT INTO agent_team_members (
        member_id, team_id, role, target_agent_session_id, target_workspace_id, target_pane_id,
        target_tab_id, revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'worker', ?, ?, ?, ?, 1, ?, ?)
    `)
    const [other, child, sibling, parent, root] = [otherTeam, team, team, team, team].map(
      (teamId, index) => {
        const memberId = randomUUID()
        const binding = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
        insertSession.run(...binding)
        insertMember.run(memberId, teamId, ...binding, index, index)
        return memberId
      }
    )
    const setParent = database.prepare(
      'UPDATE agent_team_members SET parent_member_id = ? WHERE member_id = ?'
    )
    setParent.run(parent, child)
    setParent.run(parent, sibling)
    setParent.run(root, parent)

    const catalog = new AgentCatalog(database)
    const list = () => catalog.list({ catalogVersion: 1 })
    expect(
      list().teams[1]?.members.map(({ memberId, parentMemberId }) => [memberId, parentMemberId])
    ).toEqual([
      [child, parent],
      [sibling, parent],
      [parent, root],
      [root, undefined]
    ])

    setParent.run(child, root)
    expect(list).toThrow(
      expect.objectContaining({
        name: 'AgentCatalogError',
        code: 'invalid_catalog',
        message: 'Agent team has a cycle'
      })
    )

    setParent.run(other, root)
    expect(list).toThrow(
      expect.objectContaining({
        name: 'AgentCatalogError',
        code: 'invalid_catalog',
        message: 'Agent team parent is invalid'
      })
    )

    database.pragma('foreign_keys = OFF')
    setParent.run(randomUUID(), root)
    expect(list).toThrow(
      expect.objectContaining({
        name: 'AgentCatalogError',
        code: 'invalid_catalog',
        message: 'Agent team parent is invalid'
      })
    )
  } finally {
    database.close()
  }
})
