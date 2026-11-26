import { performance } from 'node:perf_hooks'

import { expect, it } from 'vitest'

import { TerminalService } from './terminal-service'

for (const byteLength of [8, 32, 4096, 65536]) {
  it(`checkpoints 512 KiB in ${byteLength}-byte chunks`, async () => {
    const samples: number[] = []
    const count = (512 * 1024) / byteLength
    const chunk = Buffer.alloc(byteLength, 120)
    for (let run = 0; run < 11; run += 1) {
      let output: (data: Buffer) => void = () => {}
      const service = new TerminalService({
        spawn: () =>
          Promise.resolve({
            pid: 1234,
            onData(listener) {
              output = listener
              return { dispose() {} }
            },
            onExit: () => ({ dispose() {} }),
            write() {},
            resize() {},
            kill() {}
          })
      })
      try {
        const { terminal } = await service.create({ cwd: process.cwd(), rows: 24, cols: 80 })
        for (let index = 0; index < count; index += 1) output(chunk)
        const checkpoint = {
          sequence: count,
          rows: 24,
          cols: 80,
          activeBuffer: 'normal' as const,
          data: 'screen'
        }
        const start = performance.now()
        service.checkpoint(terminal.id, checkpoint)
        const elapsed = performance.now() - start
        if (run >= 2) samples.push(elapsed)
        expect(service.attach(terminal.id)).toMatchObject({
          checkpoint,
          output: [],
          lastSequence: count,
          reconstructionComplete: true
        })
      } finally {
        service.dispose()
      }
    }
    console.info(
      JSON.stringify({ byteLength, count, samples, medianMs: samples.toSorted((a, b) => a - b)[4] })
    )
  })
}

for (const byteLength of [8, 32, 4096]) {
  it(`evicts a 64 KiB prefix from a full journal of ${byteLength}-byte chunks`, async () => {
    const samples: number[] = []
    const count = (512 * 1024) / byteLength
    const chunk = Buffer.alloc(byteLength, 120)
    const burst = Buffer.alloc(65536, 121)
    for (let run = 0; run < 11; run += 1) {
      let output: (data: Buffer) => void = () => {}
      const service = new TerminalService({
        spawn: () =>
          Promise.resolve({
            pid: 1234,
            onData(listener) {
              output = listener
              return { dispose() {} }
            },
            onExit: () => ({ dispose() {} }),
            write() {},
            resize() {},
            kill() {}
          })
      })
      try {
        const { terminal } = await service.create({ cwd: process.cwd(), rows: 24, cols: 80 })
        for (let index = 0; index < count; index += 1) output(chunk)
        const before = service.attach(terminal.id)
        const start = performance.now()
        output(burst)
        const elapsed = performance.now() - start
        if (run >= 2) samples.push(elapsed)
        const after = service.attach(terminal.id)
        expect(after.output).toEqual([
          ...before.output.slice(burst.length / byteLength),
          { sequence: count + 1, data: burst.toString('base64'), byteLength: burst.length }
        ])
        expect(after.lastSequence).toBe(count + 1)
        expect(after.reconstructionComplete).toBe(false)
      } finally {
        service.dispose()
      }
    }
    console.info(
      JSON.stringify({
        operation: 'eviction',
        byteLength,
        count,
        samples,
        medianMs: samples.toSorted((a, b) => a - b)[4]
      })
    )
  })
}
