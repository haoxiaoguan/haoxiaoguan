import { ipcMain } from 'electron'

import { toIpcError } from '../../../ipc/error'
import { UPDATER_CHANNELS } from '../../../../shared/ipc-channels'
import type { UpdateStatus } from '../../../../shared/api-types'
import type { UpdaterService } from '../updater-service'

// 注册 updater 的 IPC handlers：check / download / install / getStatus。
// 状态变化的推送（updater:status）由 main.ts 接 setStatusListener → webContents.send。
export function registerUpdaterHandlers(svc: UpdaterService): void {
  ipcMain.handle(UPDATER_CHANNELS.check, async (): Promise<void> => {
    try {
      await svc.check()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(UPDATER_CHANNELS.download, async (): Promise<void> => {
    try {
      await svc.download()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(UPDATER_CHANNELS.install, async (): Promise<void> => {
    try {
      await svc.install()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(UPDATER_CHANNELS.getStatus, async (): Promise<UpdateStatus> => {
    try {
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
