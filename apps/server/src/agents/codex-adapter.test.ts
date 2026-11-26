import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { CodexAdapter } from './codex-adapter'

it.skipIf(process.platform !== 'linux')(
  'reads a transcript across JSONL chunks and split UTF-8 bytes',
  async () => {
    const thread = randomUUID()
    const message = { role: 'assistant', text: 'before 🌙� after' }
    const [prefix, suffix] = JSON.stringify({
      id: 2,
      result: {
        thread: {
          id: thread,
          turns: [{ items: [{ id: 'message', type: 'agentMessage', text: message.text }] }]
        }
      }
    }).split('🌙�')
    const directory = mkdtempSync(join(tmpdir(), 'codex-transcript-'))
    const executable = join(directory, 'codex-fixture')
    let adapter: CodexAdapter | undefined
    try {
      writeFileSync(
        executable,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'codex-cli 0.142.4\\n'
  exit 0
fi
read -r initialize
printf '\\n{"method":"notification"}\\n{"id":1,"result":{}}\\r\\n'
read -r initialized
read -r thread_read
printf '%s\\360\\237' '${prefix}'
sleep 0.1
printf '\\214\\231\\377%s\\r\\n\\n' '${suffix}'
read -r end
`,
        { mode: 0o500 }
      )
      adapter = await CodexAdapter.fromExecutable(executable)
      await expect(adapter.readTranscript(thread)).resolves.toEqual({
        messages: [message],
        skippedItems: 0
      })
    } finally {
      adapter?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

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
