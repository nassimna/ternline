import type * as Fs from 'node:fs'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
  helper: vi.fn(),
  download: vi.fn(),
  commit: vi.fn(),
  quit: vi.fn()
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { getVersion: () => '0.2.1-alpha.1', quit: mocks.quit })
  }
})
vi.mock('./mac-alpha-installer', () => ({
  stageMacAlphaUpdate: mocks.stage,
  startMacAlphaInstaller: mocks.helper
}))
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof Fs>()),
  writeFileSync: mocks.commit
}))
vi.mock('electron-updater/out/electronHttpExecutor.js', () => ({
  ElectronHttpExecutor: class {
    download = mocks.download
  }
}))

import { app } from 'electron'
import { MacAlphaUpdater } from './mac-alpha-updater'
import type { DownloadUpdateOptions, DownloadExecutorTask } from 'electron-updater/out/AppUpdater'

class TestUpdater extends MacAlphaUpdater {
  constructor(bundle: string) {
    super(bundle, {
      version: '0.2.1-alpha.1'
    } as AppAdapter)
  }
  request(options: DownloadUpdateOptions) {
    return this.doDownloadUpdate(options)
  }
  protected override async executeDownload(task: DownloadExecutorTask): Promise<string[]> {
    await task.task(
      '/cache/update.zip',
      {} as Parameters<DownloadExecutorTask['task']>[1],
      null,
      () => Promise.resolve()
    )
    await task.done!({
      version: '0.2.1-alpha.2',
      downloadedFile: '/cache/update.zip',
      files: [],
      path: '',
      sha512: '',
      releaseDate: ''
    })
    return ['/cache/update.zip']
  }
}

function options(version = '0.2.1-alpha.2', arch = process.arch): DownloadUpdateOptions {
  return {
    updateInfoAndProvider: {
      info: { version },
      provider: {
        resolveFiles: () => [
          {
            url: new URL(`https://updates.test/agent-workspace-${version}-macos-${arch}.zip`),
            info: { sha512: 'expected' }
          }
        ]
      }
    }
  } as unknown as DownloadUpdateOptions
}

beforeEach(() => {
  app.removeAllListeners()
  vi.clearAllMocks()
})

describe('unsigned alpha updater', () => {
  it('only downloads the running architecture and alpha versions', async () => {
    const updater = new TestUpdater('/Applications/Ternline.app')
    updater.logger = null
    await expect(updater.request(options('0.2.1'))).rejects.toThrow('alpha')
    await expect(
      updater.request(options('0.2.1-alpha.2', process.arch === 'arm64' ? 'x64' : 'arm64'))
    ).rejects.toThrow('matching')
    expect(mocks.download).not.toHaveBeenCalled()
    await updater.request(options())
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(mocks.quit).not.toHaveBeenCalled()
  })

  it('deduplicates restart requests and commits only at final quit', async () => {
    const updater = new TestUpdater('/Applications/Ternline.app')
    updater.logger = null
    const helper = new EventEmitter()
    mocks.stage.mockResolvedValue({ stage: '/stage', replacement: '/stage/Ternline.app' })
    mocks.helper.mockResolvedValue(helper)
    await updater.request(options())
    updater.quitAndInstall()
    updater.quitAndInstall()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(mocks.stage).toHaveBeenCalledOnce()
    expect(mocks.commit).not.toHaveBeenCalled()
    app.emit('before-quit', { preventDefault() {} })
    expect(mocks.commit).not.toHaveBeenCalled()
    app.emit('quit')
    expect(mocks.commit).toHaveBeenCalledWith(join('/stage', 'commit'), '', { mode: 0o600 })
  })

  it('reports staging failure without quitting or scheduling replacement', async () => {
    const updater = new TestUpdater('/Applications/Ternline.app')
    updater.logger = null
    const error = vi.fn()
    updater.on('error', error)
    mocks.stage.mockRejectedValue(new Error('read-only installation'))
    await updater.request(options())
    updater.quitAndInstall()
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.helper).not.toHaveBeenCalled()
    expect(app.listenerCount('quit')).toBe(0)
  })
})
