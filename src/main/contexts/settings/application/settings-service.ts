import type { SettingsFileService } from '../infrastructure/settings-file-service'

export interface AppDirs {
  dataDir: string
  configDir: string
  logDir: string
}

export class SettingsApplicationService {
  constructor(private readonly file: SettingsFileService) {}

  getAllSettings(): Record<string, string> {
    return this.file.loadSync().toFlatKv()
  }

  async updateSettings(kv: Record<string, string>): Promise<void> {
    await this.file.mutate((s) => s.applyFlatKv(kv))
  }

  getCloseBehavior(): string {
    return this.file.loadSync().ui.closeBehavior
  }

  getSilentStart(): boolean {
    return this.file.loadSync().runtime.silentStart
  }

  getWsPort(): number {
    return this.file.loadSync().runtime.wsPort
  }

  getAllowStaleKiroImport(): boolean {
    return this.file.loadSync().runtime.allowStaleKiroImport
  }

  /** Active-account refresh intervals (minutes) keyed by platform. */
  getActiveRefreshIntervals(): Record<string, number> {
    return this.file.loadSync().runtime.refreshIntervals
  }

  /** Whole-platform batch refresh intervals (minutes; 0 = disabled) by platform. */
  getPlatformRefreshIntervals(): Record<string, number> {
    return this.file.loadSync().runtime.platformRefreshIntervals
  }

  /** Configured app/IDE launch path for a platform, or undefined. */
  getIdePath(platform: string): string | undefined {
    return this.file.loadSync().runtime.idePaths[platform]
  }
}
