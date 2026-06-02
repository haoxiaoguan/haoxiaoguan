// registerSyncHandlers — wires all 6 WebDAV sync IPC channels.
// Channel names come from SYNC_CHANNELS (canonical command names).
// Arg/return shapes are fixed by the frontend contract (map_sync.md +
// src/renderer/services/tauri.ts syncService).
//
// Arg casing (from the renderer):
//   - webdav_get_config:        no args
//   - webdav_test_connection:   { config, password?, passwordTouched }  (top-level camelCase)
//   - webdav_save_config:       { config, password?, passwordTouched, syncPassword?, syncPasswordTouched }
//   - webdav_sync_upload:       no args
//   - webdav_sync_download:     no args
//   - webdav_fetch_remote_info: no args
//
// Return casing: camelCase (source uses serde rename_all = "camelCase").
//   - getConfig        → WebdavConfig (camelCase, includes status, no passwords)
//   - testConnection   → { success: boolean }
//   - saveConfig       → void
//   - syncUpload       → { status: 'uploaded' }
//   - syncDownload     → { status: 'downloaded', needsRestart: boolean }
//   - fetchRemoteInfo  → { empty, deviceName?, createdAt?, version?, compatible }
//     (deviceName/createdAt/version omitted when null — matches source
//      skip_serializing_if = Option::is_none)

import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SYNC_CHANNELS } from './sync-channels'
import { WebdavConfig, type WebdavConfigJson } from '../domain/webdav-config'
import type { SyncApplicationService } from '../application/sync-application-service'

/** webdav_test_connection arg shape (camelCase, from the renderer). */
interface TestConnectionRequest {
  config: WebdavConfigJson
  password?: string
  passwordTouched?: boolean
}

/** webdav_save_config arg shape (camelCase, from the renderer). */
interface SaveConfigRequest {
  config: WebdavConfigJson
  password?: string
  passwordTouched?: boolean
  syncPassword?: string
  syncPasswordTouched?: boolean
}

export function registerSyncHandlers(svc: SyncApplicationService): void {
  // 1. webdav_get_config — no args → WebdavConfig (camelCase JSON, no passwords)
  ipcMain.handle(SYNC_CHANNELS.getConfig, async () => {
    try {
      return svc.getConfig().toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 2. webdav_test_connection — { config, password?, passwordTouched } → { success }
  ipcMain.handle(
    SYNC_CHANNELS.testConnection,
    async (_e, args: TestConnectionRequest): Promise<{ success: boolean }> => {
      try {
        await svc.testConnection({
          config: WebdavConfig.fromJson(args.config),
          password: args.password,
          passwordTouched: args.passwordTouched ?? false,
        })
        return { success: true }
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // 3. webdav_save_config — { config, password?, passwordTouched, syncPassword?, syncPasswordTouched } → void
  ipcMain.handle(SYNC_CHANNELS.saveConfig, async (_e, args: SaveConfigRequest) => {
    try {
      await svc.saveConfig({
        config: WebdavConfig.fromJson(args.config),
        password: args.password,
        passwordTouched: args.passwordTouched ?? false,
        syncPassword: args.syncPassword,
        syncPasswordTouched: args.syncPasswordTouched ?? false,
      })
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 4. webdav_sync_upload — no args → { status: 'uploaded' }
  ipcMain.handle(SYNC_CHANNELS.syncUpload, async () => {
    try {
      return await svc.syncUpload()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 5. webdav_sync_download — no args → { status: 'downloaded', needsRestart }
  ipcMain.handle(SYNC_CHANNELS.syncDownload, async () => {
    try {
      return await svc.syncDownload()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 6. webdav_fetch_remote_info — no args → overview (null fields omitted)
  ipcMain.handle(SYNC_CHANNELS.fetchRemoteInfo, async () => {
    try {
      const info = await svc.fetchRemoteInfo()
      const out: {
        empty: boolean
        deviceName?: string
        createdAt?: number
        version?: number
        compatible: boolean
      } = { empty: info.empty, compatible: info.compatible }
      if (info.deviceName != null) out.deviceName = info.deviceName
      if (info.createdAt != null) out.createdAt = info.createdAt
      if (info.version != null) out.version = info.version
      return out
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
