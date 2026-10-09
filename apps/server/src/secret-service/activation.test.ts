import { expect, it, vi } from 'vitest'
import { ensureSecretService } from './activation'

function busFor(daemon: Record<string, unknown>): Parameters<typeof ensureSecretService>[0] {
  return {
    getProxyObject: () => Promise.resolve({ getInterface: () => daemon })
  } as unknown as Parameters<typeof ensureSecretService>[0]
}

it('activates KDE compatibility only when the standard service has no owner', async () => {
  const start = vi.fn(() => Promise.resolve(1))
  const daemon = {
    NameHasOwner: () => Promise.resolve(false),
    ListActivatableNames: () => Promise.resolve(['org.kde.secretservicecompat']),
    StartServiceByName: start,
    GetNameOwner: () => Promise.resolve(':1.42')
  }
  await ensureSecretService(busFor(daemon))
  expect(start).toHaveBeenCalledWith('org.kde.secretservicecompat', 0)
})

it('rejects a KDE activation that does not own the standard service', async () => {
  const daemon = {
    NameHasOwner: () => Promise.resolve(false),
    ListActivatableNames: () => Promise.resolve(['org.kde.secretservicecompat']),
    StartServiceByName: () => Promise.resolve(1),
    GetNameOwner: (name: string) =>
      Promise.resolve(name === 'org.freedesktop.secrets' ? ':1.42' : ':1.43')
  }
  await expect(ensureSecretService(busFor(daemon))).rejects.toThrow('standard bus name')
})

it('uses an existing standard service without starting KDE', async () => {
  const start = vi.fn()
  await ensureSecretService(
    busFor({ NameHasOwner: () => Promise.resolve(true), StartServiceByName: start })
  )
  expect(start).not.toHaveBeenCalled()
})
