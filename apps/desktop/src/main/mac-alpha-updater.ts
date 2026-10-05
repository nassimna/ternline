import { writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater'

import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'

import { stageMacAlphaUpdate, startMacAlphaInstaller } from './mac-alpha-installer'

export class MacAlphaUpdater extends electronUpdater.AppUpdater {
  private downloaded: { file: string; version: string; sha512: string } | undefined
  private installing = false

  constructor(
    private readonly bundle: string,
    adapter?: AppAdapter
  ) {
    super(undefined, adapter)
  }

  protected override async doDownloadUpdate(options: DownloadUpdateOptions): Promise<string[]> {
    const { info, provider } = options.updateInfoAndProvider
    if (!/^\d+\.\d+\.\d+-alpha\.\d+$/u.test(info.version)) {
      throw new Error('Unsigned Mac installations can only install alpha updates')
    }
    const files = provider.resolveFiles(info)
    const file = files.find(({ url }) => url.pathname.endsWith(`-macos-${process.arch}.zip`))
    if (!file) throw new Error('No matching macOS update archive')
    return this.executeDownload({
      fileExtension: 'zip',
      fileInfo: file,
      downloadUpdateOptions: options,
      task: (destination, downloadOptions) =>
        new ElectronHttpExecutor((auth, callback) => this.emit('login', auth, callback)).download(
          file.url,
          destination,
          downloadOptions
        ),
      done: (event) => {
        this.downloaded = {
          file: event.downloadedFile,
          version: event.version,
          sha512: file.info.sha512
        }
        this.dispatchUpdateDownloaded(event)
        return Promise.resolve()
      }
    })
  }

  override quitAndInstall(): void {
    if (this.installing) return
    if (!this.downloaded) {
      this.dispatchError(new Error('No downloaded update'))
      return
    }
    this.installing = true
    void this.install(this.downloaded).catch(() => {
      this.installing = false
      this.dispatchError(new Error('Unable to prepare macOS alpha update'))
    })
  }

  private async install(downloaded: {
    file: string
    version: string
    sha512: string
  }): Promise<void> {
    const { stage, replacement } = await stageMacAlphaUpdate(
      this.bundle,
      downloaded.file,
      downloaded.version,
      downloaded.sha512
    )
    try {
      const helper = await startMacAlphaInstaller(
        stage,
        this.bundle,
        replacement,
        process.argv.slice(1)
      )
      let committed = false
      const commit = (): void => {
        writeFileSync(join(stage, 'commit'), '', { mode: 0o600 })
        committed = true
      }
      helper.once('exit', () => {
        app.removeListener('quit', commit)
        if (!committed) {
          this.installing = false
          this.dispatchError(new Error('macOS update handoff timed out'))
        }
      })
      app.once('quit', commit)
      // Run the normal before-quit cleanup; the helper cannot replace a running app.
      app.quit()
    } catch (error) {
      await rm(stage, { recursive: true, force: true })
      throw error
    }
  }
}
