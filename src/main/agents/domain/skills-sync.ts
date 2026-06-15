// SkillsSync capability interface -- mirrors Rust agents::domain::skills_sync.
// SyncMethod and related types are defined here (SSOT in agents domain) and
// re-exported into the skill domain to avoid circular dependencies.

export type SyncMethod = 'auto' | 'symlink' | 'copy'

/**
 * Outcome of a sync_skill call — mirrors Rust SyncOutcome
 * { method_used: SyncMethod, files_synced: u32 }.
 * `methodUsed` reports which strategy actually ran (Auto resolves to symlink or
 * copy). `filesSynced` is a shallow count of entries in the target dir.
 */
export interface SyncOutcome {
  methodUsed: SyncMethod
  filesSynced: number
}

export interface UnmanagedSkillEntry {
  dir_name: string
  path: string
  description?: string | undefined
}

/**
 * SkillsSync -- capability interface each skills-capable agent adapter implements.
 * - skillsRoot: absolute root dir holding the agent's skill subdirectories.
 * - syncSkill: symlink-or-copy the SSOT dir into the agent's skills dir.
 * - removeSkill: remove the skill from the agent's skills dir (no-op if absent).
 * - scanUnmanaged: list skill dirs in the agent's own skills dir (contain
 *   SKILL.md, not dotfiles); DB-tracking filter is applied by the app service.
 * - hasSkill: whether the agent already has the named skill dir.
 */
export interface SkillsSync {
  skillsRoot(): string
  syncSkill(ssotPath: string, directory: string, method: SyncMethod): Promise<SyncOutcome>
  removeSkill(directory: string): Promise<void>
  scanUnmanaged(): Promise<UnmanagedSkillEntry[]>
  hasSkill(directory: string): Promise<boolean>
}
