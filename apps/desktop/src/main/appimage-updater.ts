import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { InstallOptions } from 'electron-updater/out/BaseUpdater'

export class AppImageUpdater extends electronUpdater.AppImageUpdater {
  protected override doInstall(options: InstallOptions): boolean {
    let executable = process.env.APPIMAGE!
    const filenameUpdated = (path: string): void => {
      executable = path
    }
    this.on('appimage-filename-updated', filenameUpdated)
    try {
      // The default installer spawns before app.quit(), while our single-instance lock and
      // asynchronous service shutdown are still active.
      const installed = super.doInstall({ ...options, isForceRunAfter: false })
      if (installed && options.isForceRunAfter) {
        app.once('quit', () => {
          app.releaseSingleInstanceLock()
          void this.spawnLog(executable, process.argv.slice(1), {
            ...process.env,
            APPIMAGE_SILENT_INSTALL: 'true'
          })
        })
      }
      return installed
    } finally {
      this.removeListener('appimage-filename-updated', filenameUpdated)
    }
  }
}
