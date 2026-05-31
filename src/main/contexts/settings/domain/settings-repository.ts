import type { AppSettings } from './app-settings'

export interface SettingsRepository {
  load(): Promise<AppSettings>
  save(settings: AppSettings): Promise<void>
  snapshot(): AppSettings
}
