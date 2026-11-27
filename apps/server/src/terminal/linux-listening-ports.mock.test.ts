import { setImmediate } from 'node:timers/promises'

import { expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({ readdir: vi.fn(), readFile: vi.fn(), readlink: vi.fn() }))
vi.mock('node:fs/promises', () => fs)

import { linuxListeningPorts } from './linux-listening-ports'

it.skipIf(process.platform !== 'linux')(
  'bounds descriptor reads and preserves sorted, unique ports across batches and read failures',
  async () => {
    const descriptors = Array.from({ length: 300 }, (_, index) => String(index))
    fs.readdir.mockImplementation((path: string) =>
      Promise.resolve(path === '/proc' ? ['42'] : descriptors)
    )
    fs.readFile.mockImplementation((path: string) => {
      if (path.endsWith('/stat')) return Promise.resolve('42 (shell) S 1')
      return Promise.resolve(
        [
          'header',
          ...Array.from(
            { length: 20 },
            (_, index) =>
              `0: 00000000:${(4000 + index).toString(16)} 00000000:0000 0A 0 0 0 0 0 ${index + 100}`
          )
        ].join('\n')
      )
    })
    let active = 0
    let peak = 0
    fs.readlink.mockImplementation(async (path: string) => {
      active++
      peak = Math.max(peak, active)
      await setImmediate()
      active--
      const descriptor = Number(path.split('/').at(-1))
      if (descriptor === 0) throw new Error('Descriptor closed')
      if (descriptor === 1) return '/dev/null'
      return `socket:[${100 + (descriptor % 20)}]`
    })

    expect(await linuxListeningPorts(42)).toEqual(
      Array.from({ length: 16 }, (_, index) => 4000 + index)
    )
    expect(fs.readlink).toHaveBeenCalledTimes(300)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(128)
    expect(active).toBe(0)
  }
)

it.skipIf(process.platform !== 'linux')(
  'overlaps metadata reads for up to eight PIDs and matches each PID against its own tables',
  async () => {
    const queriedPids: number[] = []
    const pending = new Set<string>()
    let peakPids = 0
    let peakReads = 0
    async function readMetadata(path: string) {
      pending.add(path)
      peakPids = Math.max(peakPids, new Set([...pending].map((entry) => entry.split('/')[2])).size)
      peakReads = Math.max(peakReads, pending.size)
      await setImmediate()
      pending.delete(path)
    }

    fs.readdir.mockImplementation(async (path: string) => {
      if (path === '/proc')
        return ['44', '99', '43', '45', '46', '47', '48', '49', '50', '51', '42']
      queriedPids.push(Number(path.split('/')[2]))
      await readMetadata(path)
      return ['0']
    })
    fs.readFile.mockImplementation(async (path: string) => {
      const pid = Number(path.split('/')[2])
      if (path.endsWith('/stat')) {
        if (pid === 42 || pid === 99) return `${pid} (shell) S 1`
        const parent = pid === 44 || pid === 45 ? 43 : 42
        return `${pid} (shell) S ${parent}`
      }
      await readMetadata(path)
      const ipv6 = path.endsWith('/tcp6')
      if (pid === 45 && !ipv6) throw new Error('Process TCP table unavailable')
      if (ipv6 !== (pid === 45)) return 'header'
      return `header\n0: 00000000:${(4000 + pid).toString(16)} 00000000:0000 0A 0 0 0 0 0 100`
    })
    let activeDescriptors = 0
    let peakDescriptors = 0
    fs.readlink.mockImplementation(async () => {
      activeDescriptors++
      peakDescriptors = Math.max(peakDescriptors, activeDescriptors)
      await setImmediate()
      activeDescriptors--
      return 'socket:[100]'
    })

    expect(await linuxListeningPorts(42)).toEqual(
      Array.from({ length: 10 }, (_, index) => 4042 + index)
    )
    expect(queriedPids).toEqual([42, 43, 45, 46, 47, 48, 49, 50, 51, 44])
    expect(peakPids).toBe(8)
    expect(peakReads).toBe(24)
    expect(peakDescriptors).toBe(1)
  }
)
