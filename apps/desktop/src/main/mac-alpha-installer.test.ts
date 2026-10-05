import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { MAC_ALPHA_INSTALL_SCRIPT, stageMacAlphaUpdate } from './mac-alpha-installer'

const execute = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('macOS alpha installer', () => {
  async function fixture(version = '0.2.1-alpha.2', id = 'dev.agentworkspace.desktop') {
    const root = await mkdtemp(join(tmpdir(), 'ternline-alpha-test-'))
    directories.push(root)
    const installed = join(root, "Ternline 'test.app")
    async function bundle(path: string, value: string, bundleId: string) {
      await mkdir(join(path, 'Contents/MacOS'), { recursive: true })
      await writeFile(
        join(path, 'Contents/Info.plist'),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleShortVersionString</key><string>${value}</string><key>CFBundleExecutable</key><string>Test</string></dict></plist>`
      )
      await writeFile(join(path, 'Contents/MacOS/Test'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    }
    await bundle(installed, '0.2.1-alpha.1', 'dev.agentworkspace.desktop')
    const next = join(root, 'next', 'Ternline.app')
    await bundle(next, version, id)
    const zip = join(root, 'update.zip')
    await execute('/usr/bin/ditto', ['-c', '-k', '--keepParent', next, zip])
    const sha512 = createHash('sha512')
      .update(await readFile(zip))
      .digest('base64')
    return { root, installed, zip, sha512 }
  }

  it('stages a matching bundle without changing the installed version', async () => {
    const f = await fixture()
    const { replacement } = await stageMacAlphaUpdate(f.installed, f.zip, '0.2.1-alpha.2', f.sha512)
    expect(await readFile(join(replacement, 'Contents/Info.plist'), 'utf8')).toContain('alpha.2')
    expect(await readFile(join(f.installed, 'Contents/Info.plist'), 'utf8')).toContain('alpha.1')
  })

  it.each([
    ['0.2.1-alpha.3', 'dev.agentworkspace.desktop'],
    ['0.2.1-alpha.2', 'unrelated.app']
  ])('rejects mismatched bundle metadata and cleans staging (%s, %s)', async (version, id) => {
    const f = await fixture(version, id)
    await expect(
      stageMacAlphaUpdate(f.installed, f.zip, '0.2.1-alpha.2', f.sha512)
    ).rejects.toThrow('identity or version')
    expect((await readdir(f.root)).filter((name) => name.startsWith('.ternline-update-'))).toEqual(
      []
    )
  })

  it('rechecks the checksum at install time', async () => {
    const f = await fixture()
    await writeFile(f.zip, 'tampered')
    await expect(
      stageMacAlphaUpdate(f.installed, f.zip, '0.2.1-alpha.2', f.sha512)
    ).rejects.toThrow('checksum')
  })

  it('rejects non-alpha target versions', async () => {
    const f = await fixture()
    await expect(stageMacAlphaUpdate(f.installed, f.zip, '0.2.1', f.sha512)).rejects.toThrow(
      'alpha'
    )
  })

  it.each([false, true])(
    'waits for exit, preserves arguments, and rolls back launch failure=%s',
    async (fail) => {
      const f = await fixture()
      const { stage, replacement } = await stageMacAlphaUpdate(
        f.installed,
        f.zip,
        '0.2.1-alpha.2',
        f.sha512
      )
      const parent = spawn('/bin/sleep', ['30'])
      const launcher = join(f.root, 'launch')
      const output = join(f.root, 'args')
      // Exercise the actual shell helper and filesystem swaps with a deterministic launcher.
      await writeFile(
        launcher,
        `#!/bin/sh\nif [ ! -f "$TEST_OUTPUT" ]; then\n printf '%s\\n' "$@" > "$TEST_OUTPUT"\n exit ${fail ? 1 : 0}\nfi\nexit 0\n`,
        { mode: 0o755 }
      )
      const child = spawn(
        '/bin/sh',
        [
          '-c',
          MAC_ALPHA_INSTALL_SCRIPT.replaceAll('/usr/bin/open', '"$TEST_LAUNCHER"'),
          'test',
          stage,
          f.installed,
          replacement,
          String(parent.pid),
          '--user-data-dir=a b',
          '$(false)'
        ],
        { env: { ...process.env, TEST_LAUNCHER: launcher, TEST_OUTPUT: output } }
      )
      const done = new Promise<number | null>((resolve) => child.once('exit', resolve))
      try {
        await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
        await writeFile(join(stage, 'commit'), '')
        await new Promise((resolve) => setTimeout(resolve, 1100))
        expect(await readFile(join(f.installed, 'Contents/Info.plist'), 'utf8')).toContain(
          'alpha.1'
        )
        parent.kill()
        expect(await done).toBe(fail ? 1 : 0)
        expect(await readFile(join(f.installed, 'Contents/Info.plist'), 'utf8')).toContain(
          fail ? 'alpha.1' : 'alpha.2'
        )
        expect((await readFile(output, 'utf8')).split('\n')).toContain('--user-data-dir=a b')
        expect(
          (await readdir(f.root)).filter((name) => name.startsWith('.ternline-update-'))
        ).toEqual([])
      } finally {
        parent.kill()
        child.kill()
      }
    }
  )
})
