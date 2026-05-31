import { readFile } from 'node:fs/promises'
import { AppSettings } from '../domain/app-settings'
import type { SettingsRepository } from '../domain/settings-repository'
import { atomicWrite } from '../../../platform/fs/atomic-write'

export class SettingsFileService implements SettingsRepository {
  private readonly path: string
  private cache: AppSettings

  constructor(path: string) {
    this.path = path
    this.cache = AppSettings.fromJson({})
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.path, 'utf8')
      this.cache = AppSettings.fromJson(JSON.parse(raw))
    } catch {
      // Missing or corrupt → heal with defaults and persist immediately.
      this.cache = AppSettings.fromJson({})
      await this.save(this.cache)
    }
    return this.cache
  }

  loadSync(): AppSettings {
    return this.cache
  }

  snapshot(): AppSettings {
    return AppSettings.fromJson(this.cache.toJson())
  }

  async save(settings: AppSettings): Promise<void> {
    this.cache = settings
    await atomicWrite(this.path, JSON.stringify(settings.toJson(), null, 2))
  }

  async mutate(fn: (s: AppSettings) => void): Promise<void> {
    fn(this.cache)
    await this.save(this.cache)
  }
}
