import { execFile, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const alphaVersion = /^\d+\.\d+\.\d+-alpha\.\d+$/u

export function isUnsignedMacAlpha(bundle: string, version: string): boolean {
  if (!alphaVersion.test(version)) return false
  const result = spawnSync('/usr/bin/codesign', ['-dv', bundle], { encoding: 'utf8' })
  return (
    result.stderr.includes('Signature=adhoc') ||
    result.stderr.includes('code object is not signed at all')
  )
}

async function plist(bundle: string, key: string): Promise<string> {
  const { stdout } = await execute('/usr/bin/plutil', [
    '-extract',
    key,
    'raw',
    '-o',
    '-',
    join(bundle, 'Contents/Info.plist')
  ])
  return stdout.trim()
}

export async function stageMacAlphaUpdate(
  installed: string,
  zip: string,
  version: string,
  sha512: string
) {
  const hash = createHash('sha512')
  await pipeline(createReadStream(zip), hash)
  if (hash.digest('base64') !== sha512) throw new Error('Update checksum mismatch')
  if (!alphaVersion.test(version)) throw new Error('Unsigned updates require an alpha release')
  if (!(await lstat(installed)).isDirectory()) {
    throw new Error('Update requires a regular installed application bundle')
  }
  await access(dirname(installed), constants.W_OK)
  const stage = await mkdtemp(join(dirname(installed), '.ternline-update-'))
  try {
    const { stdout: entries } = await execute('/usr/bin/unzip', ['-Z', '-1', zip], {
      maxBuffer: 16 * 1024 * 1024
    })
    const paths = entries.trim().split('\n')
    const root = paths[0]?.split('/')[0]
    if (!root || !root.endsWith('.app'))
      throw new Error('Update archive must contain an application')
    if (paths.some((entry) => !entry.startsWith(`${root}/`) || entry.split('/').includes('..')))
      throw new Error('Update archive contains unexpected paths')
    await execute('/usr/bin/ditto', ['-x', '-k', zip, stage])
    const replacement = join(stage, root)
    if ((await readdir(stage)).length !== 1 || (await lstat(replacement)).isSymbolicLink()) {
      throw new Error('Update archive must contain one application')
    }
    const [id, nextId, nextVersion, executable] = await Promise.all([
      plist(installed, 'CFBundleIdentifier'),
      plist(replacement, 'CFBundleIdentifier'),
      plist(replacement, 'CFBundleShortVersionString'),
      plist(replacement, 'CFBundleExecutable')
    ])
    if (id !== nextId || nextVersion !== version || basename(executable) !== executable) {
      throw new Error('Update bundle identity or version does not match')
    }
    await access(join(replacement, 'Contents/MacOS', executable), constants.X_OK)
    return { stage, replacement }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

// Positional arguments keep paths and launch arguments out of shell source. The helper
// requires an explicit commit AND the old process to exit before touching the live bundle.
export const MAC_ALPHA_INSTALL_SCRIPT = `
set -eu
stage=$1
installed=$2
replacement=$3
parent=$4
shift 4
backup="$stage/previous.app"
count=0
printf 'ready\\n'
while [ ! -f "$stage/commit" ] || /bin/kill -0 "$parent" 2>/dev/null; do
  count=$((count + 1))
  if [ "$count" -ge 120 ]; then
    /bin/rm -rf "$stage"
    exit 1
  fi
  /bin/sleep 1
done
if ! /bin/mv "$installed" "$backup"; then
  /bin/rm -rf "$stage"
  exit 1
fi
if ! /bin/mv "$replacement" "$installed"; then
  /bin/mv "$backup" "$installed"
  /usr/bin/open -n "$installed" --args "$@"
  /bin/rm -rf "$stage"
  exit 1
fi
if ! /usr/bin/open -n "$installed" --args "$@"; then
  /bin/mv "$installed" "$replacement"
  /bin/mv "$backup" "$installed"
  /usr/bin/open -n "$installed" --args "$@"
  /bin/rm -rf "$stage"
  exit 1
fi
/bin/rm -rf "$stage"
`

export async function startMacAlphaInstaller(
  stage: string,
  installed: string,
  replacement: string,
  args: string[]
) {
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      MAC_ALPHA_INSTALL_SCRIPT,
      'ternline-update',
      stage,
      installed,
      replacement,
      String(process.pid),
      ...args
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Update helper exited before handoff')))
    child.stdout.once('data', () => resolve())
  })
  child.stdout.destroy()
  child.unref()
  return child
}
