// IPC handler registration for the localBackup bounded context.
// Channel names come from LOCAL_BACKUP_CHANNELS in src/shared/ipc-channels.ts.
// Arg/return shapes are fixed by the frontend contract (map_local_backup.md):
//   - local_backup_create   → BackupEntry (camelCase)
//   - local_backup_list     → BackupEntry[] (camelCase)
//   - local_backup_restore  → string (safety snapshot filename)
//   - local_backup_delete   → void
//   - local_backup_rename   → BackupEntry (camelCase)
//   - local_backup_get_config → LocalBackupConfig (camelCase)
//   - local_backup_save_config → void

import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { LOCAL_BACKUP_CHANNELS } from '../../../../shared/ipc-channels'
import type { LocalBackupApplicationService } from '../application/local-backup-service'
import { LocalBackupConfig } from '../domain/local-backup-config'

export function registerLocalBackupHandlers(svc: LocalBackupApplicationService): void {
  // local_backup_create — no args → BackupEntry
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.create, async () => {
    try {
      const entry = await svc.createBackup()
      return entry.toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // local_backup_list — no args → BackupEntry[]
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.list, async () => {
    try {
      const entries = await svc.listBackups()
      return entries.map((e) => e.toJson())
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // local_backup_restore — { filename: string } → string (safety snapshot filename)
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.restore, async (_e, filename: string) => {
    try {
      return await svc.restoreBackup(filename)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // local_backup_delete — { filename: string } → void
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.delete, async (_e, filename: string) => {
    try {
      await svc.deleteBackup(filename)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // local_backup_rename — { old_filename: string, new_name: string } → BackupEntry
  // Args arrive as a plain object with snake_case keys (frontend contract).
  ipcMain.handle(
    LOCAL_BACKUP_CHANNELS.rename,
    async (_e, arg: { old_filename: string; new_name: string }) => {
      try {
        const entry = await svc.renameBackup(arg.old_filename, arg.new_name)
        return entry.toJson()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // local_backup_get_config — no args → LocalBackupConfig (camelCase)
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.getConfig, async () => {
    try {
      return svc.getConfig().toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // local_backup_save_config — { config: LocalBackupConfig } → void
  ipcMain.handle(LOCAL_BACKUP_CHANNELS.saveConfig, async (_e, config: { intervalHours: number; retainCount: number }) => {
    try {
      await svc.saveConfig(LocalBackupConfig.fromJson(config))
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
