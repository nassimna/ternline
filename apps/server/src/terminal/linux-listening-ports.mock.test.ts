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
