// Shared SkillsSync implementation — mirrors the identical skills_root-bound
// sync/remove/scan/has pattern repeated across every skills-capable adapter in
// the Rust source. Bound to a single skillsRoot directory.

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError } from '../../domain/agent-error'
import type { SkillsSync, SyncMethod, SyncOutcome, UnmanagedSkillEntry } from '../../domain/skills-sync'
import { syncDir, countFiles } from './symlink-or-copy'
import { scanSkillsDir } from './skill-scan'

export class DirSkillsSync implements SkillsSync {
  constructor(private readonly root: string) {}

  skillsRoot(): string {
    return this.root
  }

  async syncSkill(ssotPath: string, directory: string, method: SyncMethod): Promise<SyncOutcome> {
    const target = join(this.root, directory)
    const methodUsed = syncDir(ssotPath, target, method)
    return { methodUsed, filesSynced: countFiles(target) }
  }

  async removeSkill(directory: string): Promise<void> {
    const target = join(this.root, directory)
    if (!existsSync(target)) return
    try {
      await rm(target, { recursive: true, force: true })
    } catch (e) {
      throw AgentError.filesystem(target, e)
    }
  }

  async scanUnmanaged(): Promise<UnmanagedSkillEntry[]> {
    return scanSkillsDir(this.root)
  }

  async hasSkill(directory: string): Promise<boolean> {
    return existsSync(join(this.root, directory))
  }
}
