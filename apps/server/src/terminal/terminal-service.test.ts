import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_OUTPUT_CHUNK_BYTES,
  TerminalService,
  TerminalServiceError,
  type PtyAdapter,
  type PtyProcess
} from './terminal-service'
import { NodePtyAdapter } from './node-pty-adapter'

class FakePty implements PtyProcess {
  public readonly pid = 1234
  public readonly writes: Array<string | Buffer> = []
  public readonly sizes: [number, number][] = []
  public killed = false
  private dataListener: (data: Buffer) => void = () => {}
  private exitListener: (event: { exitCode: number }) => void = () => {}

  public onData(listener: (data: Buffer) => void): { dispose(): void } {
    this.dataListener = listener
    return { dispose: () => (this.dataListener = () => {}) }
  }

  public onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } {
    this.exitListener = listener
    return { dispose: () => (this.exitListener = () => {}) }
  }

  public write(data: string | Buffer): void {
    this.writes.push(data)
  }

  public resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows])
  }

  public kill(): void {
    this.killed = true
  }

  public output(data: string): void {
    this.dataListener(Buffer.from(data))
  }

  public exit(exitCode: number): void {
    this.exitListener({ exitCode })
  }
}

function createFixture(): { service: TerminalService; pty: FakePty } {
  const pty = new FakePty()
  const adapter: PtyAdapter = { spawn: () => Promise.resolve(pty) }
  return { service: new TerminalService(adapter), pty }
}

describe('TerminalService', () => {
  it.each([0, 32768, 65536])(
    'checkpoints %i tiny chunks without changing the retained suffix or byte accounting',
    async (sequence) => {
      const { service, pty } = createFixture()
      const { terminal } = await service.create({ rows: 24, cols: 80 })
      try {
        for (let index = 0; index < 65536; index += 1) pty.output('12345678')
        const before = service.attach(terminal.id)
        const checkpoint = {
          sequence,
          rows: 24,
          cols: 80,
          activeBuffer: 'normal' as const,
          data: 'screen'
        }

        service.checkpoint(terminal.id, checkpoint)
        service.checkpoint(terminal.id, checkpoint)

        const attached = service.attach(terminal.id)
        expect(attached.output).toEqual(before.output.slice(sequence))
        expect(attached.checkpoint).toEqual(checkpoint)
        expect(attached.lastSequence).toBe(65536)
        expect(attached.reconstructionComplete).toBe(true)
        if (sequence > 0) {
          expect(() =>
            service.checkpoint(terminal.id, { ...checkpoint, sequence: sequence - 1 })
          ).toThrow('Checkpoint is older than the accepted one')
          expect(service.attach(terminal.id)).toEqual(attached)
        }

        pty.output('x'.repeat(MAX_OUTPUT_CHUNK_BYTES * 4))
        const final = service.attach(terminal.id)
        expect(final.output).toEqual(
          [1, 2, 3, 4].map((offset) => ({
            sequence: 65536 + offset,
            data: Buffer.from('x'.repeat(MAX_OUTPUT_CHUNK_BYTES)).toString('base64'),
            byteLength: MAX_OUTPUT_CHUNK_BYTES
          }))
        )
        expect(final.reconstructionComplete).toBe(sequence === 65536)
      } finally {
        service.dispose()
      }
    }
  )

  it('retains the rolling suffix through steady overflow and a subsequent checkpoint', async () => {
    const { service, pty } = createFixture()
    const { terminal } = await service.create({ rows: 24, cols: 80 })
    const chunkBytes = 4 * 1024
    const input = Array.from({ length: 259 }, (_, index) =>
      String(index + 1).padEnd(chunkBytes, 'x')
    )
    const expected = input.map((text, index) => ({
      sequence: index + 1,
      data: Buffer.from(text).toString('base64'),
      byteLength: chunkBytes
    }))

    try {
      for (const text of input.slice(0, 129)) pty.output(text)
      expect(service.attach(terminal.id)).toMatchObject({
        output: expected.slice(1, 129),
        lastSequence: 129,
        reconstructionComplete: false
      })

      for (const text of input.slice(129, 258)) pty.output(text)
      expect(service.attach(terminal.id)).toMatchObject({
        output: expected.slice(130, 258),
        lastSequence: 258,
        reconstructionComplete: false
      })

      const checkpoint = {
        sequence: 130,
        rows: 24,
        cols: 80,
        activeBuffer: 'normal' as const,
        data: 'screen'
      }
      service.checkpoint(terminal.id, checkpoint)
      expect(service.attach(terminal.id)).toMatchObject({
        output: expected.slice(130, 258),
        reconstructionComplete: true
      })

      const laterCheckpoint = { ...checkpoint, sequence: 194 }
      service.checkpoint(terminal.id, laterCheckpoint)
      expect(service.attach(terminal.id)).toMatchObject({
        checkpoint: laterCheckpoint,
        output: expected.slice(194, 258),
        reconstructionComplete: true
      })

      pty.output(input[258]!)
      expect(service.attach(terminal.id)).toMatchObject({
        output: expected.slice(195),
        lastSequence: 259,
        reconstructionComplete: false
      })
    } finally {
      service.dispose()
    }
  })

  it.each([false, true])(
    'evicts tiny chunks before each output event with checkpoint=%s',
    async (withCheckpoint) => {
      const { service, pty } = createFixture()
      const { terminal } = await service.create({ rows: 24, cols: 80 })
      try {
        if (withCheckpoint) {
          service.checkpoint(terminal.id, {
            sequence: 0,
            rows: 24,
            cols: 80,
            activeBuffer: 'normal',
            data: 'screen'
          })
        }
        const limit = (withCheckpoint ? 256 : 512) * 1024
        const count = limit / 8
        for (let index = 0; index < count; index += 1) pty.output('12345678')
        const before = service.attach(terminal.id)
        expect(before.reconstructionComplete).toBe(true)
        service.subscribe(terminal.id, (event) => {
          if (event.event === 'terminal.output') {
            snapshots.push(service.attach(terminal.id))
          }
          events.push(event.event)
        })
        const snapshots: ReturnType<TerminalService['attach']>[] = []
        const events: string[] = []

        pty.output('y'.repeat(MAX_OUTPUT_CHUNK_BYTES * 2))

        expect(events).toEqual(['terminal.output', 'terminal.output'])
        expect(snapshots).toHaveLength(2)
        for (const [index, snapshot] of snapshots.entries()) {
          expect(snapshot.output).toEqual([
            ...before.output.slice(((index + 1) * MAX_OUTPUT_CHUNK_BYTES) / 8),
            ...Array.from({ length: index + 1 }, (_, offset) => ({
              sequence: count + offset + 1,
              data: Buffer.from('y'.repeat(MAX_OUTPUT_CHUNK_BYTES)).toString('base64'),
              byteLength: MAX_OUTPUT_CHUNK_BYTES
            }))
          ])
          expect(snapshot.lastSequence).toBe(count + index + 1)
          expect(snapshot.reconstructionComplete).toBe(false)
          expect(snapshot.checkpoint).toEqual(before.checkpoint)
          expect(snapshot.output.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBe(limit)
        }
        expect(service.attach(terminal.id)).toEqual(snapshots[1])

        const lastSequence = count + 2
        service.checkpoint(terminal.id, {
          sequence: lastSequence,
          rows: 24,
          cols: 80,
          activeBuffer: 'normal',
          data: 'new screen'
        })
        pty.output('z'.repeat(64 * 1024))
        expect(events.slice(-2)).toEqual(['terminal.output', 'terminal.checkpointRequested'])
        expect(service.attach(terminal.id)).toMatchObject({
          output: [{ sequence: lastSequence + 1, byteLength: 64 * 1024 }],
          lastSequence: lastSequence + 1,
          reconstructionComplete: true
        })
      } finally {
        service.dispose()
      }
    }
  )

  it('keeps ordered output, accepts checkpoints, and marks missing replay data', async () => {
    const { service, pty } = createFixture()
    const { terminal } = await service.create({ rows: 24, cols: 80, cwd: resolve('.') })
    const events: string[] = []
    const unsubscribe = service.subscribe(terminal.id, (event) => events.push(event.event))

    pty.output('first')
    expect(service.attach(terminal.id).output).toEqual([
      { sequence: 1, data: Buffer.from('first').toString('base64'), byteLength: 5 }
    ])
    service.checkpoint(terminal.id, {
      sequence: 1,
      rows: 24,
      cols: 80,
      activeBuffer: 'normal',
      data: 'screen'
    })
    pty.output('next')
    const attached = service.attach(terminal.id)
    expect(attached.checkpoint?.sequence).toBe(1)
    expect(attached.output.map((chunk) => chunk.sequence)).toEqual([2])
    expect(attached.reconstructionComplete).toBe(true)
    expect(events).toEqual(['terminal.output', 'terminal.output'])

    pty.output('x'.repeat(MAX_OUTPUT_CHUNK_BYTES * 5))
    expect(service.attach(terminal.id).reconstructionComplete).toBe(false)
    expect(
      service.attach(terminal.id).output.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    ).toBeLessThanOrEqual(256 * 1024)
    unsubscribe()
    service.close(terminal.id)
    expect(pty.killed).toBe(true)
  })

  it('routes input and resize to the PTY and retains an exited snapshot', async () => {
    const { service, pty } = createFixture()
    const { terminal } = await service.create({ rows: 24, cols: 80, command: ['/bin/sh'] })
    service.send(terminal.id, Buffer.from('printf hello\n'))
    service.resize(terminal.id, 40, 120)
    pty.exit(7)

    expect(pty.writes).toEqual([Buffer.from('printf hello\n')])
    expect(pty.sizes).toEqual([[120, 40]])
    expect(service.attach(terminal.id).terminal).toMatchObject({
      rows: 40,
      cols: 120,
      exited: true,
      exitCode: 7
    })
    expect(() => service.send(terminal.id, Buffer.from('later'))).toThrow(TerminalServiceError)
  })

  it('rejects a future checkpoint without losing output', async () => {
    const { service, pty } = createFixture()
    const { terminal } = await service.create({ rows: 24, cols: 80 })
    pty.output('ready')
    expect(() =>
      service.checkpoint(terminal.id, {
        sequence: 2,
        rows: 24,
        cols: 80,
        activeBuffer: 'normal',
        data: 'bad'
      })
    ).toThrow('ahead')
    expect(service.attach(terminal.id).lastSequence).toBe(1)
    service.dispose()
  })

  it('kills a PTY that finishes spawning after shutdown starts', async () => {
    const pty = new FakePty()
    let startSpawn!: () => void
    let finishSpawn!: (process: PtyProcess) => void
    const started = new Promise<void>((resolve) => {
      startSpawn = resolve
    })
    const adapter: PtyAdapter = {
      spawn: () => {
        startSpawn()
        return new Promise<PtyProcess>((resolve) => {
          finishSpawn = resolve
        })
      }
    }
    const service = new TerminalService(adapter)
    const creation = service.create({ rows: 24, cols: 80 })
    await started
    service.dispose()
    finishSpawn(pty)
    await expect(creation).rejects.toMatchObject({ code: 'service_stopping' })
    expect(pty.killed).toBe(true)
  })

  it('requires an observed PTY exit and retains unverified processes for retry', async () => {
    const { service, pty } = createFixture()
    const { terminal } = await service.create({ rows: 24, cols: 80 })
    await expect(service.terminateObserved(terminal.id, 10)).rejects.toMatchObject({
      code: 'termination_unverified'
    })
    expect(pty.killed).toBe(true)
    expect(() => service.attach(terminal.id)).toThrow('being terminated')
    expect(() => service.send(terminal.id, Buffer.from('later'))).toThrow('being terminated')
    pty.kill = () => {
      pty.exit(0)
    }
    expect(await service.terminateObserved(terminal.id, 100)).toMatchObject({ exitCode: 0 })
    expect(() => service.attach(terminal.id)).toThrow('does not exist')
  })

  it.skipIf(process.platform !== 'linux')('observes a disposable real PTY exit', async () => {
    const service = new TerminalService(new NodePtyAdapter())
    try {
      const { terminal } = await service.create({
        rows: 24,
        cols: 80,
        command: ['/bin/sleep', '30']
      })
      expect((await service.terminateObserved(terminal.id, 5_000)).exitCode).toEqual(
        expect.any(Number)
      )
      expect(() => service.attach(terminal.id)).toThrow('does not exist')
    } finally {
      service.dispose()
    }
  })
})
