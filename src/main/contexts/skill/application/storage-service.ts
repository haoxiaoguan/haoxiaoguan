// StorageService -- storage location and sync method accessors.
// Mirrors Rust modules::skill::application::storage_service.
// set_storage_location and migrate_skill are TODO stubs (same as Rust source).

import { defaultSsotRoot } from './skill-application-service'

export class StorageService {
  /** Always returns 'haoxiaoguan' -- hardcoded default (mirrors Rust). */
  getStorageLocation(): string {
    return 'haoxiaoguan'
  }

  /**
   * TODO stub -- no-op. Intended to migrate all skills to new location.
   * Mirrors Rust set_storage_location stub.
   */
  async setStorageLocation(_location: string): Promise<void> {
    // stub
  }

  /**
   * TODO stub -- no-op. Intended to move skill files between storage locations.
   * Mirrors Rust migrate_skill stub.
   */
  async migrateSkill(_skillId: string, _target: string): Promise<void> {
    // stub
  }

  ssotRoot(): string {
    return defaultSsotRoot()
  }
}
