import { beforeEach, expect, it, vi } from 'vitest'

const child = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        command: string,
        args: string[],
        options: { timeout: number; maxBuffer: number },
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => void
    >()
}))
vi.mock('node:child_process', () => child)

import { testSshConnection } from './ssh-workspace-connection'

beforeEach(() => child.execFile.mockReset())

it('authenticates with the chosen SSH details using a bounded fresh connection', async () => {
  const pending = testSshConnection({
    host: 'prod',
    user: 'deploy',
    port: 2222,
    identityFile: '/keys/deploy key'
  })
  const [command, args, options, callback] = child.execFile.mock.calls[0]!
  expect(command).toBe('ssh')
  expect(args).toEqual([
    '-o',
    'BatchMode=yes',
    '-o',
    'ControlPath=none',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ClearAllForwardings=yes',
    '-T',
    '-i',
    '/keys/deploy key',
    '-p',
    '2222',
    'deploy@prod',
    'true'
  ])
  expect(options).toEqual({ timeout: 15_000, maxBuffer: 64 * 1024 })
  callback(null, '', '')
  await expect(pending).resolves.toBeUndefined()
})

it('reports authentication failures and timeouts instead of treating process launch as success', async () => {
  const denied = testSshConnection({ host: 'prod', user: '', port: 22 })
  child.execFile.mock.calls[0]![3](new Error('exit 255'), '', 'Permission denied (publickey).')
  await expect(denied).rejects.toThrow('Permission denied (publickey).')
  const timeout = testSshConnection({ host: 'prod', user: '', port: 22 })
  child.execFile.mock.calls[1]![3](new Error('Timed out'), '', '')
  await expect(timeout).rejects.toThrow('Timed out')
})
