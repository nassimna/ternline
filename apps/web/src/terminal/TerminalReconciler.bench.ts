import { describe, it } from 'vitest'

import { TerminalReconciler } from './TerminalReconciler'

describe('terminal output reconciliation', () => {
  for (const byteLength of [256, 4 * 1024, 64 * 1024]) {
    const data = btoa('x'.repeat(byteLength))
    it(`1 MiB in ${byteLength}-byte chunks`, async ({ bench }) => {
      const result = await bench('reconcile', async () => {
        const reconciler = new TerminalReconciler(
          { reset() {}, write: (_data, callback) => callback?.() },
          () => {
            throw new Error('Unexpected sequence gap')
          }
        )
        const pending: Promise<void>[] = []
        for (let sequence = 1; sequence <= (1024 * 1024) / byteLength; sequence += 1) {
          pending.push(reconciler.applyChunk({ sequence, data, byteLength }))
        }
        await Promise.all(pending)
        reconciler.dispose()
      }).run({ iterations: 16 })
      console.info(JSON.stringify({ byteLength, mib: 1, medianMs: result.latency.p50 }))
    })
  }
})
