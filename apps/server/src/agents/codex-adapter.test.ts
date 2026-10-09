import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { CodexAdapter } from './codex-adapter'

it.skipIf(process.platform === 'win32')(
  'rejects a closed app-server stdin as interrupted and stops the child without an uncaught error',
  async () => {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'codex-closed-stdin-'))
    const executable = join(directory, 'codex-fixture')
    const pidPath = join(directory, 'child-pid')
    writeFileSync(
      executable,
      `#!/bin/sh
read -r initialize
printf '%s\\n' "$$" > ${JSON.stringify(pidPath)}
exec 0<&-
printf '{"id":1,"result":{}}\\n'
exec sleep 30
`
    )
    chmodSync(executable, 0o500)
    const file = statSync(executable)
    const identity = {
      device: file.dev,
      inode: file.ino,
      uid: file.uid,
      mode: file.mode,
      size: file.size,
      sha256: createHash('sha256').update(readFileSync(executable)).digest('hex')
    }
    const adapter = Object.create(CodexAdapter.prototype) as CodexAdapter
    Object.assign(adapter, {
      source: executable,
      privatePath: executable,
      directory,
      sourceIdentity: identity,
      copyIdentity: identity
    })
    try {
      await expect(adapter.verifyThread(randomUUID())).rejects.toMatchObject({
        code: 'interrupted'
      })
      const pid = Number(readFileSync(pidPath, 'utf8'))
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
    } finally {
      adapter.close()
    }
  }
)
