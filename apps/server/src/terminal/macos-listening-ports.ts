import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { processDescendants } from './process-descendants'

const execute = promisify(execFile)

/** lsof's process selection is intersected with TCP listeners, including IPv6. */
export async function macosListeningPorts(rootPid: number): Promise<number[]> {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return []
  const { stdout: tree } = await execute('/bin/ps', ['-axo', 'pid=,ppid='], {
    timeout: 2_000,
    maxBuffer: 1024 * 1024
  }).catch(() => ({ stdout: '' }))
  const relations: Array<readonly [number, number]> = []
  let hasRoot = false
  for (const line of tree.trim().split('\n')) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number)
    if (pid === rootPid) hasRoot = true
    if (pid && parent) relations.push([pid, parent])
  }
  if (!hasRoot) return []
  const descendants = processDescendants(rootPid, relations)
  const { stdout } = await execute(
    '/usr/sbin/lsof',
    ['-nP', '-a', '-p', descendants.join(','), '-iTCP', '-sTCP:LISTEN', '-Fn'],
    { timeout: 2_000, maxBuffer: 1024 * 1024 }
  ).catch(() => ({ stdout: '' }))
  const ports = new Set<number>()
  for (const line of stdout.split('\n')) {
    const match = /^n.*:(\d+)$/.exec(line)
    const port = match ? Number(match[1]) : 0
    if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b).slice(0, 16)
}
