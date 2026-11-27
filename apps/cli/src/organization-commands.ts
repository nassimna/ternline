import type { AgentWorkspaceClient } from '@agent-workspace/client-runtime'

import { runJsonMutation } from './json-mutations'
import { flags, mutationIdentity, nonnegativeInteger, required, workspaceIdFlags } from './options'

type Operation =
  | 'workspace.selectMany'
  | 'group.create'
  | 'group.rename'
  | 'group.delete'
  | 'group.move'
  | 'group.assign'
  | 'group.collapse'

export interface OrganizationCommand {
  sessionFile: string
  command: 'organization.mutate'
  operation: Operation
  values: Map<string, string>
  selection?: string[]
}

const groupOptions: Record<string, readonly string[]> = {
  create: ['--group-id', '--name'],
  rename: ['--group-id', '--name'],
  delete: ['--group-id'],
  move: ['--group-id', '--destination-index'],
  assign: ['--workspace-id', '--group-id'],
  collapse: ['--group-id', '--collapsed']
}

const revisionOptions = ['--expected-revision', '--idempotency-key'] as const

export function parseOrganizationCommand(
  args: string[],
  sessionFile: string
): OrganizationCommand | undefined {
  if (args[0] === 'workspace' && args[1] === 'select-many') {
    const { values, workspaceIds: selection } = workspaceIdFlags(args.slice(2), [
      '--focused-workspace-id',
      ...revisionOptions
    ])
    required(values, '--focused-workspace-id')
    required(values, '--expected-revision')
    return {
      sessionFile,
      command: 'organization.mutate',
      operation: 'workspace.selectMany',
      values,
      selection
    }
  }
  if (args[0] !== 'group' || !Object.hasOwn(groupOptions, args[1] ?? '')) return undefined
  const action = args[1]!
  const { values } = flags(args.slice(2), [...groupOptions[action]!, ...revisionOptions])
  required(values, '--expected-revision')
  for (const option of groupOptions[action]!) {
    if (action === 'assign' && option === '--group-id') continue
    required(values, option)
  }
  return {
    sessionFile,
    command: 'organization.mutate',
    operation: `group.${action}` as Operation,
    values
  }
}

export function runOrganizationCommand(
  client: AgentWorkspaceClient,
  parsed: OrganizationCommand,
  idempotencyEpoch: string
): Promise<unknown> {
  const { values, operation } = parsed
  const identity = mutationIdentity(values, idempotencyEpoch)
  switch (operation) {
    case 'workspace.selectMany':
      return runJsonMutation(client, operation, {
        selection: parsed.selection,
        focusedWorkspaceId: required(values, '--focused-workspace-id'),
        ...identity
      })
    case 'group.create':
    case 'group.rename':
      return runJsonMutation(client, operation, {
        groupId: required(values, '--group-id'),
        name: required(values, '--name'),
        ...identity
      })
    case 'group.delete':
      return runJsonMutation(client, operation, {
        groupId: required(values, '--group-id'),
        ...identity
      })
    case 'group.move':
      return runJsonMutation(client, operation, {
        groupId: required(values, '--group-id'),
        destinationIndex: nonnegativeInteger(
          required(values, '--destination-index'),
          '--destination-index'
        ),
        ...identity
      })
    case 'group.assign':
      return runJsonMutation(client, operation, {
        workspaceId: required(values, '--workspace-id'),
        ...(values.has('--group-id') ? { groupId: values.get('--group-id') } : {}),
        ...identity
      })
    case 'group.collapse': {
      const value = required(values, '--collapsed')
      if (value !== 'true' && value !== 'false') {
        throw new Error('--collapsed must be true or false')
      }
      return runJsonMutation(client, operation, {
        groupId: required(values, '--group-id'),
        collapsed: value === 'true',
        ...identity
      })
    }
  }
}
