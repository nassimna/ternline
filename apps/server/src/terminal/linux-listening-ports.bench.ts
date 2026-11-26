import { spawn } from 'node:child_process'
import { once } from 'node:events'

import { expect, it } from 'vitest'

import { linuxListeningPorts } from './linux-listening-ports'

for (const descriptors of [32, 1024, 4096]) {
  it.skipIf(process.platform !== 'linux')(
    `discovers a listener alongside ${descriptors} open file descriptors`,
    async () => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `const fs = require('node:fs')
           const net = require('node:net')
           for (let i = 0; i < ${descriptors}; i++) fs.openSync('/dev/null', 'r')
           net.createServer().listen(0, '127.0.0.1', function () {
             console.log(this.address().port)
           })`
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
      )
      const exited = once(child, 'exit')
      try {
        const ready = await Promise.race([
          once(child.stdout, 'data'),
          exited.then(() => {
            throw new Error('Listener exited before ready')
          })
        ])
        const port = Number(String(ready[0]).trim())
        const samples: number[] = []
        for (let run = 0; run < 11; run++) {
          const start = performance.now()
          const ports = await linuxListeningPorts(child.pid!)
          const elapsed = performance.now() - start
          expect(ports).toEqual([port])
          if (run >= 2) samples.push(elapsed)
        }
        console.info(
          JSON.stringify({
            descriptors,
            samples,
            medianMs: samples.toSorted((a, b) => a - b)[4]
          })
        )
      } finally {
        child.kill()
        await exited
      }
    }
  )
}
