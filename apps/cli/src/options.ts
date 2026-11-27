import { randomUUID } from 'node:crypto'

export function flags(
  args: string[],
  allowed: readonly string[],
  commandTail = false,
  tailFlag = '--command'
) {
  const values = new Map<string, string>()
  let command: string[] | undefined
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!
    if (commandTail && flag === tailFlag) {
      command = args.slice(index + 1)
      if (command.length === 0) throw new Error(`${tailFlag} requires a program`)
      break
    }
    if (!allowed.includes(flag) || values.has(flag)) {
      throw new Error(`Unknown or repeated option: ${flag}`)
    }
    const value = args[index + 1]
    if (value === undefined || allowed.includes(value)) {
      throw new Error(`${flag} requires a value`)
    }
    values.set(flag, value)
    index += 1
  }
  return { values, command }
}

export function workspaceIdFlags(args: string[], allowed: readonly string[]) {
  const workspaceIds: string[] = []
  const remainder: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--workspace-id') {
      remainder.push(args[index]!)
      continue
    }
    const id = args[++index]
    if (!id || id.startsWith('--')) throw new Error('--workspace-id requires a value')
    workspaceIds.push(id)
  }
  const { values } = flags(remainder, allowed)
  if (workspaceIds.length === 0) throw new Error('--workspace-id is required')
  return { values, workspaceIds }
}

export function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag)
  if (!value) throw new Error(`${flag} is required`)
  return value
}

export function nonnegativeInteger(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} must be a nonnegative safe integer`)
  }
  return Number(value)
}

export function mutationIdentity(values: Map<string, string>, idempotencyEpoch: string) {
  return {
    expectedRevision: nonnegativeInteger(
      required(values, '--expected-revision'),
      '--expected-revision'
    ),
    idempotencyEpoch,
    idempotencyKey: values.get('--idempotency-key') ?? randomUUID()
  }
}

export function jsonParams(args: string[]): unknown {
  const { values } = flags(args, ['--params-json'])
  const raw = required(values, '--params-json')
  if (Buffer.byteLength(raw) > 64 * 1024) {
    throw new Error('JSON request is too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Request must be a JSON object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request must be a JSON object')
  }
  return parsed
}
