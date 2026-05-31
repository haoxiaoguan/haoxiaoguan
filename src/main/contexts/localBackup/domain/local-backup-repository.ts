// Repository port (interface) for LocalBackup.
// The localBackup context has no SQLite tables of its own — it operates on
// the live DB connection and raw .db snapshot files on disk.
// This interface is intentionally minimal; the heavy lifting lives in the
// infrastructure adapters (BackupFsService, DbArchiveService).

import type { BackupEntry } from './backup-entry'
import type { LocalBackupConfig } from './local-backup-config'

export interface LocalBackupRepository {
  /** List all .db files in the backup directory, sorted by mtime desc. */
  listBackups(): Promise<BackupEntry[]>

  /** Delete a backup file by filename. */
  deleteBackup(filename: string): Promise<void>

  /** Rename a backup file; returns the updated entry. */
  renameBackup(oldFilename: string, newFilename: string): Promise<BackupEntry>

  /** Read config from settings.json local_backup section. */
  getConfig(): LocalBackupConfig

  /** Write config to settings.json local_backup section (merge-write). */
  saveConfig(config: LocalBackupConfig): Promise<void>
}
