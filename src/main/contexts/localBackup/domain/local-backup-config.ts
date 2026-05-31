// LocalBackupConfig value object.
// retainCount is clamped to [1, 50] on both read and write.
// intervalHours = 0 disables auto-backup entirely.
// Serialised camelCase in settings.json under the "local_backup" key.

export const RETAIN_MIN = 1
export const RETAIN_MAX = 50

export interface LocalBackupConfigData {
  intervalHours: number
  retainCount: number
}

const DEFAULTS: LocalBackupConfigData = {
  intervalHours: 6,
  retainCount: 12,
}

export class LocalBackupConfig {
  readonly intervalHours: number
  readonly retainCount: number

  private constructor(intervalHours: number, retainCount: number) {
    this.intervalHours = intervalHours
    // Clamp on construction — invariant enforced here.
    this.retainCount = Math.max(RETAIN_MIN, Math.min(RETAIN_MAX, retainCount))
  }

  static fromJson(raw: Partial<LocalBackupConfigData>): LocalBackupConfig {
    const merged = { ...DEFAULTS, ...raw }
    return new LocalBackupConfig(merged.intervalHours, merged.retainCount)
  }

  static defaults(): LocalBackupConfig {
    return LocalBackupConfig.fromJson({})
  }

  toJson(): LocalBackupConfigData {
    return {
      intervalHours: this.intervalHours,
      retainCount: this.retainCount,
    }
  }
}
