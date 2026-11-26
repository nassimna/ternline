import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { detectWorkspacePathOpeners, launchWorkspacePathInIde } from './workspace-path-openers'

describe('workspace path opener detection', () => {
  it('reports only executable whitelisted IDE commands after the file explorer', async () => {
    const executableDirectory = await mkdtemp(join(tmpdir(), 'agent-workspace-openers-'))
    try {
      const code = join(executableDirectory, 'code')
      const cursor = join(executableDirectory, 'cursor')
      await Promise.all([writeFile(code, '#!/bin/sh\n'), writeFile(cursor, '#!/bin/sh\n')])
      await Promise.all([chmod(code, 0o755), chmod(cursor, 0o644)])
      await mkdir(join(executableDirectory, 'codium'))

      await expect(detectWorkspacePathOpeners(executableDirectory)).resolves.toEqual([
        { id: 'fileManager', label: 'File Explorer', kind: 'fileManager' },
        { id: 'vscode', label: 'Visual Studio Code', kind: 'ide' }
      ])
    } finally {
      await rm(executableDirectory, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'launches an executable symlink after a directory on PATH',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'agent-workspace-openers-'))
      try {
        const first = join(directory, 'first')
        const second = join(directory, 'second')
        await mkdir(join(first, 'code'), { recursive: true })
        await mkdir(second)
        const executable = join(second, 'editor')
        await writeFile(executable, '#!/bin/sh\nprintf opened > "$1"\n', { mode: 0o755 })
        await symlink(executable, join(second, 'code'))

        await expect(detectWorkspacePathOpeners([first, second].join(delimiter))).resolves.toEqual([
          { id: 'fileManager', label: 'File Explorer', kind: 'fileManager' },
          { id: 'vscode', label: 'Visual Studio Code', kind: 'ide' }
        ])
        const marker = join(directory, 'opened')
        await launchWorkspacePathInIde('vscode', marker, [first, second].join(delimiter))
        await expect.poll(() => readFile(marker, 'utf8')).toBe('opened')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
})
