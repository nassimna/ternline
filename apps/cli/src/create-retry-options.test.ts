import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

void test('create commands preserve retry option validation order', async (t) => {
  const directory = realpathSync(mkdtempSync(join(homedir(), '.ternline-cli-test-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const cli = join(directory, 'bin.mjs')
  const sessionFile = join(directory, 'session.json')
  await build({
    entryPoints: [fileURLToPath(new URL('./bin.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['koffi'],
    outfile: cli
  })

  const commands = [
    {
      command: 'terminal',
      requiredFlag: '--workspace-id',
      requiredArgs: ['--workspace-id', 'workspace', '--pane-id', 'pane', '--cwd', directory],
      numericFlag: '--destination-index',
      numericMinimum: 0
    },
    {
      command: 'workspace',
      requiredFlag: '--name',
      requiredArgs: ['--name', 'Workspace', '--working-directory', directory],
      numericFlag: '--rows',
      numericMinimum: 1
    }
  ]

  const missingRevision = '--idempotency-key requires --expected-revision for safe retries'
  const invalidRevision = '--expected-revision must be an integer at least 0'
  const missingSession = `ENOENT: no such file or directory, lstat '${sessionFile}'`
  for (const { command, requiredFlag, requiredArgs, numericFlag, numericMinimum } of commands) {
    const cases = [
      { args: ['--idempotency-key', ''], message: missingRevision },
      { args: ['--expected-revision', 'bad'], message: `${requiredFlag} is required` },
      {
        args: [...requiredArgs, numericFlag, 'bad', '--expected-revision', 'bad'],
        message: `${numericFlag} must be an integer at least ${numericMinimum}`
      },
      {
        args: [...requiredArgs, '--expected-revision', '9007199254740992'],
        message: invalidRevision
      },
      {
        args: [...requiredArgs, '--expected-revision', '0', '--idempotency-key', ''],
        message: missingSession
      },
      {
        args: [...requiredArgs, '--command', 'program', '--idempotency-key', 'argument'],
        message: missingSession
      }
    ]
    for (const { args, message } of cases) {
      if (message === missingSession && process.platform === 'win32') continue
      const run = spawnSync(
        process.execPath,
        [cli, '--session-file', sessionFile, command, 'create', ...args],
        { encoding: 'utf8' }
      )
      assert.ifError(run.error)
      const label = `${command} create ${JSON.stringify(args)}`
      assert.equal(run.status, 1, label)
      assert.equal(run.stderr, `ternline-cli: ${message}\n`, label)
    }
  }
})
