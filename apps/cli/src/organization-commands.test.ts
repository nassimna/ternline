import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AgentWorkspaceClient } from '@agent-workspace/client-runtime'
import { parseOrganizationCommand, runOrganizationCommand } from './organization-commands'

const epoch = 'b31ab001-5435-4c98-9e7a-18442259e901'
const first = 'a9e87f23-84fd-412c-ab32-6ec11bacaa31'
const second = 'df6df812-d30f-4e8f-9ff9-d8637ecfd751'
const group = '641b0ef7-e547-491e-a7af-ec027a4abc62'
const key = '265f9a77-e32a-487e-adb6-59b9f44bd2d3'

function parse(args: string[]) {
  const parsed = parseOrganizationCommand(args, '/private/session')
  assert.ok(parsed)
  return parsed
}

await test('multiselection keeps order and uses exact revision and retry key', async () => {
  const parsed = parse([
    'workspace',
    'select-many',
    '--workspace-id',
    second,
    '--workspace-id',
    first,
    '--focused-workspace-id',
    first,
    '--expected-revision',
    '12',
    '--idempotency-key',
    key
  ])
  const expected = {
    selection: [second, first],
    focusedWorkspaceId: first,
    expectedRevision: 12,
    idempotencyEpoch: epoch,
    idempotencyKey: key
  }
  const seen: unknown[] = []
  const response = Promise.resolve({ revision: 13 })
  const client = {
    selectWorkspaces: (request: unknown) => {
      seen.push(request)
      return response
    }
  } as unknown as AgentWorkspaceClient
  const result = runOrganizationCommand(client, parsed, epoch)
  assert.equal(result, response)
  assert.deepEqual(await result, { revision: 13 })
  assert.deepEqual(seen, [expected])
})

await test('group assignment omits group ID to unassign and dispatches to Node client', async () => {
  const parsed = parse([
    'group',
    'assign',
    '--workspace-id',
    first,
    '--expected-revision',
    '8',
    '--idempotency-key',
    key
  ])
  const seen: unknown[] = []
  const client = {
    assignGroup: (request: unknown) => {
      seen.push(request)
      return Promise.resolve({ revision: 9 })
    }
  } as unknown as AgentWorkspaceClient
  await runOrganizationCommand(client, parsed, epoch)
  assert.deepEqual(seen, [
    {
      workspaceId: first,
      expectedRevision: 8,
      idempotencyEpoch: epoch,
      idempotencyKey: key
    }
  ])
})

await test('all group verbs dispatch through their matching client operation', async () => {
  const cases = [
    {
      verb: 'create',
      options: ['--group-id', group, '--name', 'Build'],
      method: 'createGroup',
      expected: { groupId: group, name: 'Build' }
    },
    {
      verb: 'rename',
      options: ['--group-id', group, '--name', 'Review'],
      method: 'renameGroup',
      expected: { groupId: group, name: 'Review' }
    },
    {
      verb: 'delete',
      options: ['--group-id', group],
      method: 'deleteGroup',
      expected: { groupId: group }
    },
    {
      verb: 'move',
      options: ['--group-id', group, '--destination-index', '0'],
      method: 'moveGroup',
      expected: { groupId: group, destinationIndex: 0 }
    },
    {
      verb: 'assign',
      options: ['--workspace-id', first, '--group-id', group],
      method: 'assignGroup',
      expected: { workspaceId: first, groupId: group }
    },
    {
      verb: 'collapse',
      options: ['--group-id', group, '--collapsed', 'false'],
      method: 'collapseGroup',
      expected: { groupId: group, collapsed: false }
    }
  ]
  for (const { verb, options, method, expected } of cases) {
    const parsed = parse([
      'group',
      verb,
      ...options,
      '--expected-revision',
      '4',
      '--idempotency-key',
      key
    ])
    const seen: unknown[] = []
    const client = {
      [method]: (request: unknown) => {
        seen.push(request)
        return Promise.resolve({ revision: 5 })
      }
    } as unknown as AgentWorkspaceClient
    assert.deepEqual(await runOrganizationCommand(client, parsed, epoch), { revision: 5 })
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0], {
      ...expected,
      expectedRevision: 4,
      idempotencyEpoch: epoch,
      idempotencyKey: key
    })
  }
})

await test('group flags reject invalid booleans and revisions before sending', (context) => {
  const selectWorkspaces = context.mock.fn()
  const client = { selectWorkspaces } as unknown as AgentWorkspaceClient
  assert.throws(
    () => parse(['group', 'create', '--group-id', group, '--expected-revision', '1']),
    /--name is required/
  )
  assert.throws(
    () =>
      parse([
        'workspace',
        'select-many',
        '--focused-workspace-id',
        first,
        '--expected-revision',
        '1'
      ]),
    /--workspace-id is required/
  )
  assert.throws(
    () =>
      runOrganizationCommand(
        client,
        parse([
          'group',
          'collapse',
          '--group-id',
          group,
          '--collapsed',
          'yes',
          '--expected-revision',
          '1'
        ]),
        epoch
      ),
    /--collapsed must be true or false/
  )
  assert.throws(
    () =>
      runOrganizationCommand(
        client,
        parse([
          'group',
          'move',
          '--group-id',
          group,
          '--destination-index',
          '1e3',
          '--expected-revision',
          '1'
        ]),
        epoch
      ),
    /--destination-index must be a nonnegative safe integer/
  )
  assert.throws(
    () =>
      runOrganizationCommand(
        client,
        parse([
          'workspace',
          'select-many',
          '--workspace-id',
          first,
          '--workspace-id',
          first,
          '--focused-workspace-id',
          first,
          '--expected-revision',
          '1'
        ]),
        epoch
      ),
    {
      name: 'ZodError',
      issues: [
        {
          code: 'custom',
          path: [],
          message: 'workspace selection must be unique and include the focused workspace'
        }
      ]
    }
  )
  assert.equal(selectWorkspaces.mock.callCount(), 0)
  assert.throws(
    () =>
      runOrganizationCommand(
        client,
        parse(['group', 'delete', '--group-id', group, '--expected-revision', '-1']),
        epoch
      ),
    /--expected-revision must be a nonnegative safe integer/
  )
})

await test('group creation and rename reject unnormalized names before dispatch', (context) => {
  const createGroup = context.mock.fn()
  const renameGroup = context.mock.fn()
  const client = { createGroup, renameGroup } as unknown as AgentWorkspaceClient
  for (const verb of ['create', 'rename']) {
    const parsed = parse([
      'group',
      verb,
      '--group-id',
      group,
      '--name',
      ' Build ',
      '--expected-revision',
      '4',
      '--idempotency-key',
      key
    ])
    assert.throws(() => runOrganizationCommand(client, parsed, epoch), {
      name: 'ZodError',
      issues: [
        {
          code: 'custom',
          path: ['name'],
          message: 'text must be normalized and within its bound'
        }
      ]
    })
  }
  assert.equal(createGroup.mock.callCount(), 0)
  assert.equal(renameGroup.mock.callCount(), 0)
})
