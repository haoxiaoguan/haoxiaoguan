// SkillApplicationService -- install, uninstall, toggle, update, check-updates,
// scan-unmanaged, import-from-agent use cases.
// Mirrors Rust modules::skill::application::skill_service::SkillApplicationService.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { InstalledSkillRepository } from '../domain/installed-skill-repository'
import type { SkillBackupRepository } from '../domain/skill-backup-repository'
import { InstalledSkill, type DiscoverableSkill, type UnmanagedSkillEntry } from '../domain/installed-skill'
import { SkillError } from '../domain/skill-error'
import type { AgentId } from '../../../agents/domain/agent-id'
import type { AgentRegistry } from '../../../agents/domain/agent-registry'
import type { SkillsSync } from '../../../agents/domain/skills-sync'
import { scanSkillsDir } from './skill-scan-helper'

export interface SkillUninstallResult {
  removed_from_agents: string[]
}

/** Default SSOT root: ~/.haoxiaoguan/skills */
export function defaultSsotRoot(): string {
  return join(homedir(), '.haoxiaoguan', 'skills')
}

export class SkillApplicationService {
  constructor(
    private readonly installedRepo: InstalledSkillRepository,
    private readonly backupRepo: SkillBackupRepository,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  async getInstalled(): Promise<InstalledSkill[]> {
    return this.installedRepo.findAll()
  }

  async install(skill: DiscoverableSkill, targetAgent: AgentId): Promise<InstalledSkill> {
    // Enforce uniqueness by directory
    const existing = await this.installedRepo.findByDirectory(skill.directory)
    if (existing) {
      throw SkillError.alreadyInstalled(skill.directory)
    }

    const now = Math.floor(Date.now() / 1000)
    const id = randomUUID()
    const ssotPath = join(defaultSsotRoot(), skill.directory)

    try {
      mkdirSync(ssotPath, { recursive: true })
    } catch (e) {
      throw SkillError.filesystem(ssotPath, e as Error)
    }

    const apps: Record<string, boolean> = { [targetAgent]: true }

    const installed = InstalledSkill.create({
      id,
      name: skill.name,
      description: skill.description,
      directory: skill.directory,
      repo_owner: skill.repo_owner,
      repo_name: skill.repo_name,
      repo_branch: skill.repo_branch,
      readme_url: skill.readme_url,
      apps,
      installed_at: now,
      updated_at: now,
      content_hash: undefined,
      ssot_path: ssotPath,
      storage_location: 'haoxiaoguan',
    })

    // Sync to target agent (best-effort -- agent may not support Skills)
    await this.syncToAgent(installed, targetAgent)

    await this.installedRepo.save(installed)
    return installed
  }

  async uninstall(id: string): Promise<SkillUninstallResult> {
    const skill = await this.installedRepo.findById(id)
    if (!skill) throw SkillError.notFound(id)

    const removedFrom: string[] = []
    for (const agentId of skill.enabledAgents()) {
      const sync = this.getSkillsSync(agentId)
      if (sync) {
        try {
          await sync.removeSkill(skill.directory)
          removedFrom.push(agentId)
        } catch {
          // Best-effort -- continue removing from other agents
        }
      }
    }

    await this.installedRepo.delete(id)
    return { removed_from_agents: removedFrom }
  }

  async toggleApp(id: string, agent: AgentId, enabled: boolean): Promise<boolean> {
    const skill = await this.installedRepo.findById(id)
    if (!skill) throw SkillError.notFound(id)

    skill.apps[agent] = enabled
    skill.updated_at = Math.floor(Date.now() / 1000)

    if (enabled) {
      await this.syncToAgent(skill, agent)
    } else {
      const sync = this.getSkillsSync(agent)
      if (sync) {
        try {
          await sync.removeSkill(skill.directory)
        } catch {
          // Best-effort
        }
      }
    }

    await this.installedRepo.save(skill)
    return enabled
  }

  async update(id: string): Promise<InstalledSkill> {
    const skill = await this.installedRepo.findById(id)
    if (!skill) throw SkillError.notFound(id)

    skill.updated_at = Math.floor(Date.now() / 1000)

    for (const agentId of skill.enabledAgents()) {
      await this.syncToAgent(skill, agentId)
    }

    await this.installedRepo.save(skill)
    return skill
  }

  /** Always returns false -- TODO: compare content_hash with remote. */
  async checkUpdates(_id: string): Promise<boolean> {
    return false
  }

  async scanUnmanaged(agent: AgentId): Promise<UnmanagedSkillEntry[]> {
    const sync = this.getSkillsSync(agent)
    if (!sync) {
      throw SkillError.agent(`agent '${agent}' does not support Skills capability`)
    }

    let entries: UnmanagedSkillEntry[] = []
    try {
      entries = await sync.scanUnmanaged()
    } catch (e) {
      throw SkillError.agent(String(e))
    }

    // Append ~/.agents/skills/ entries (unified standard dir), dedup by dir_name
    const unifiedDir = join(homedir(), '.agents', 'skills')
    try {
      const unifiedEntries = await scanSkillsDir(unifiedDir)
      const existing = new Set(entries.map((e) => e.dir_name))
      for (const entry of unifiedEntries) {
        if (!existing.has(entry.dir_name)) {
          entries.push(entry)
        }
      }
    } catch {
      // Unified dir may not exist -- ignore
    }

    // Filter out already-managed directories
    const installed = await this.installedRepo.findAll()
    const installedDirs = new Set(installed.map((s) => s.directory))
    return entries.filter((e) => !installedDirs.has(e.dir_name))
  }

  async importFromAgent(agent: AgentId, dirNames: string[]): Promise<InstalledSkill[]> {
    const now = Math.floor(Date.now() / 1000)
    const imported: InstalledSkill[] = []

    // Build description map from scan results
    let descMap: Map<string, string | undefined>
    try {
      const unmanaged = await this.scanUnmanaged(agent)
      descMap = new Map(unmanaged.map((e) => [e.dir_name, e.description]))
    } catch {
      descMap = new Map()
    }

    for (const dirName of dirNames) {
      const existing = await this.installedRepo.findByDirectory(dirName)
      if (existing) {
        // Merge: enable for this agent and re-sync
        existing.apps[agent] = true
        existing.updated_at = now
        await this.syncToAgent(existing, agent)
        await this.installedRepo.save(existing)
        imported.push(existing)
        continue
      }

      const id = randomUUID()
      const ssotPath = join(defaultSsotRoot(), dirName)
      const apps: Record<string, boolean> = { [agent]: true }

      const skill = InstalledSkill.create({
        id,
        name: dirName,
        description: descMap.get(dirName),
        directory: dirName,
        apps,
        installed_at: now,
        updated_at: now,
        ssot_path: ssotPath,
        storage_location: 'haoxiaoguan',
      })

      await this.installedRepo.save(skill)
      imported.push(skill)
    }

    return imported
  }

  private async syncToAgent(skill: InstalledSkill, agent: AgentId): Promise<void> {
    const sync = this.getSkillsSync(agent)
    if (!sync) return // Agent doesn't support Skills -- skip silently
    try {
      await sync.syncSkill(skill.ssot_path, skill.directory, 'auto')
    } catch (e) {
      throw SkillError.agent(String(e))
    }
  }

  private getSkillsSync(agent: AgentId): SkillsSync | undefined {
    const client = this.agentRegistry.get(agent)
    if (!client) return undefined
    // AgentClient.asSkillsSync() is optional -- check if it exists
    const c = client as unknown as { asSkillsSync?: () => SkillsSync | undefined }
    return c.asSkillsSync?.()
  }
}
