import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { app } = vi.hoisted(() => ({
  app: { once: vi.fn(), releaseSingleInstanceLock: vi.fn() }
}))
vi.mock('electron', () => ({ app }))

import { AppImageUpdater } from './appimage-updater'

describe.skipIf(process.platform !== 'linux')('AppImage update restart', () => {
  let directory: string | undefined
  beforeEach(() => {
    app.once.mockReset()
    app.releaseSingleInstanceLock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  function fixture(filename: string, payload: string) {
    mkdirSync('target', { recursive: true })
    directory = mkdtempSync(join(process.cwd(), 'target/appimage-update-'))
    const installed = join(directory, filename)
    mkdirSync(join(directory, 'pending'))
    const downloaded = join(directory, 'pending', 'agent-workspace-0.2.1-alpha.2.AppImage')
    writeFileSync(installed, 'old executable')
    writeFileSync(downloaded, payload, { mode: 0o755 })
    vi.stubEnv('APPIMAGE', installed)
    const events = new EventEmitter()
    app.once.mockImplementation((event: string, listener: () => void) =>
      events.once(event, listener)
    )
    const updater = new AppImageUpdater(undefined, { version: '0.2.1-alpha.1' })
    updater.logger = null
    Object.defineProperty(updater, 'downloadedUpdateHelper', {
      value: { file: downloaded, downloadedFileInfo: {} }
    })
    const spawn = vi.fn().mockResolvedValue(true)
    Object.defineProperty(updater, 'spawnLog', { value: spawn })
    return { updater, events, installed, spawn }
  }

  it.each(['agent-workspace.AppImage', 'agent-workspace-0.2.1-alpha.1.AppImage'])(
    'installs %s and relaunches its new path only at final quit',
    (filename) => {
      const payload = '#!/bin/sh\ntest "$APPIMAGE_EXIT_AFTER_INSTALL" = true\n'
      const { updater, events, installed, spawn } = fixture(filename, payload)
      const destination =
        filename === 'agent-workspace.AppImage'
          ? installed
          : join(directory!, 'agent-workspace-0.2.1-alpha.2.AppImage')

      expect(updater.install(false, true)).toBe(true)
      expect(readFileSync(destination, 'utf8')).toBe(payload)
      if (destination !== installed) expect(existsSync(installed)).toBe(false)
      expect(spawn).not.toHaveBeenCalled()
      expect(updater.listenerCount('appimage-filename-updated')).toBe(0)

      events.emit('will-quit')
      expect(spawn).not.toHaveBeenCalled()
      events.emit('quit')
      expect(app.releaseSingleInstanceLock).toHaveBeenCalledOnce()
      expect(spawn).toHaveBeenCalledExactlyOnceWith(
        destination,
        process.argv.slice(1),
        expect.objectContaining({ APPIMAGE_SILENT_INSTALL: 'true' })
      )
      expect(app.releaseSingleInstanceLock.mock.invocationCallOrder[0]).toBeLessThan(
        spawn.mock.invocationCallOrder[0]!
      )
      events.emit('quit')
      expect(spawn).toHaveBeenCalledOnce()
    }
  )

  it('does not schedule restart when installation fails, including a later normal quit', () => {
    const { updater, events, spawn } = fixture('agent-workspace.AppImage', '#!/bin/sh\nexit 1\n')
    const error = vi.fn()
    updater.on('error', error)

    expect(updater.install(false, true)).toBe(false)
    expect(error).toHaveBeenCalledOnce()
    expect(app.once).not.toHaveBeenCalled()
    expect(updater.listenerCount('appimage-filename-updated')).toBe(0)
    events.emit('quit')
    expect(app.releaseSingleInstanceLock).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })
})
