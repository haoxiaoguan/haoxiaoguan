// LocalBackupConfigAdapter — reads/writes only the local_backup section of settings.json.
// Uses SettingsFileService.mutate() for merge-write (does not clobber other sections).
// LocalBackupConfig lives inside AppSettings.local_backup.

import type { SettingsFileService } from '../../settings/infrastructure/settings-file-service'
import { LocalBackupConfig } from '../domain/local-backup-config'
import { BackupError } from '../domain/backup-error'

export class LocalBackupConfigAdapter {
  constructor(private readonly settingsFile: SettingsFileService) {}

  getConfig(): LocalBackupConfig {
    const raw = this.settingsFile.loadSync().localBackup as Record<string, unknown>
    return LocalBackupConfig.fromJson({
      intervalHours:
        typeof raw.intervalHours === 'number' ? raw.intervalHours : undefined,
      retainCount:
        typeof raw.retainCount === 'number' ? raw.retainCount : undefined,
    })
  }

  async saveConfig(config: LocalBackupConfig): Promise<void> {
    try {
      await this.settingsFile.mutate((s) => {
        s.localBackup = config.toJson() as unknown as Record<string, unknown>
      })
    } catch (err: unknown) {
      throw BackupError.io(String(err))
    }
  }
}
