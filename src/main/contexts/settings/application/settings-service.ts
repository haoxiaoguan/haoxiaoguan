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
}
