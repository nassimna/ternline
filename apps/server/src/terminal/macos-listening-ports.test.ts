import { execFile } from 'node:child_process'
import type * as Util from 'node:util'

import { expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:util', async (importOriginal) => ({
  ...(await importOriginal<typeof Util>()),
  promisify:
    (fn: typeof execFile) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        Reflect.apply(fn, undefined, [
          ...args,
          (error: Error | null, stdout: string) => (error ? reject(error) : resolve({ stdout }))
        ])
      })
}))

import { macosListeningPorts } from './macos-listening-ports'

it('selects the shell and out-of-order descendants in discovery order and includes IPv6 listeners', async () => {
  const execute = vi.mocked(execFile)
  execute.mockImplementation(((
    file: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, stdout: string) => void
  ) => {
    callback(
      null,
      file === '/bin/ps'
        ? '102 101\n200 1\n100 malformed\n101 100\n103 101\n101 200\n'
        : 'p102\nn*:8765\nn[::1]:5173\nn127.0.0.1:5173\n'
    )
  }) as typeof execFile)
  expect(await macosListeningPorts(100)).toEqual([5173, 8765])
  expect(execute).toHaveBeenLastCalledWith(
    '/usr/sbin/lsof',
    ['-nP', '-a', '-p', '100,101,103,102', '-iTCP', '-sTCP:LISTEN', '-Fn'],
    expect.any(Object),
    expect.any(Function)
  )
})
