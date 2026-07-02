import { readFile } from 'node:fs/promises'
import { AppSettings } from '../domain/app-settings'
import type { SettingsRepository } from '../domain/settings-repository'
import { atomicWrite } from '../../../platform/fs/atomic-write'

export class SettingsFileService implements SettingsRepository {
  private readonly path: string
  private cache: AppSettings
  // Serialises disk writes. mutate() has no lock around save(), and two
  // renderer-triggered updateSettings() calls fired close together (e.g. two
  // controls in PlatformSettingsDialog) reliably overlap in practice; without
  // this queue their atomicWrite calls race independently and whichever one's
  // rename lands last wins — even if it captured its settings snapshot BEFORE
  // the other call's mutation, silently reverting it on disk. Chaining every
  // write onto this promise guarantees they land in the same order they were
  // queued, so the most recent mutate() always has the final say.
  private writeQueue: Promise<void> = Promise.resolve()

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
    // Snapshot now (synchronous), write in queue order. A prior write's
    // failure must not stall this one — each call still gets its own
    // resolution/rejection via `write`, only the ordering is shared.
    const data = JSON.stringify(settings.toJson(), null, 2)
    const write = this.writeQueue.then(
      () => atomicWrite(this.path, data),
      () => atomicWrite(this.path, data),
    )
    this.writeQueue = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  async mutate(fn: (s: AppSettings) => void): Promise<void> {
    fn(this.cache)
    await this.save(this.cache)
  }
}
