// SkillApplicationService -- install, uninstall, toggle, update, check-updates,
// scan-unmanaged, import-from-agent use cases.
// Mirrors Rust modules::skill::application::skill_service::SkillApplicationService.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'

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

// ZIP 安装解压上限（与 sync/skills-archive 的同类防护对齐，防恶意/超大归档）。
const MAX_ZIP_ENTRIES = 10_000
const MAX_ZIP_BYTES = 512 * 1024 * 1024

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

  /**
   * 从本地 ZIP 安装技能：每个顶层目录视作一个技能解压到 SSOT root 下并持久化入库。
   *
   * 安全：三重路径穿越防护——① 顶层目录名拒绝空段/`.`/`..`；② 目标目录 resolve 后必须落在
   * SSOT root 内；③ 逐条目 resolve 后必须落在其技能目录内（防 `foo/../../x` 这类条目）。
   * 另设条目数/总字节上限防恶意归档。已存在同名 directory 仅更新时间戳（去重，不重复建条目）。
   *
   * @param ssotRootOverride 仅供测试注入隔离根目录；生产省略，使用 defaultSsotRoot()。
   */
  async installFromZip(zipPath: string, ssotRootOverride?: string): Promise<InstalledSkill[]> {
    if (!existsSync(zipPath)) {
      throw SkillError.filesystem(zipPath, new Error('zip 文件不存在'))
    }
    let zip: AdmZip
    try {
      zip = new AdmZip(zipPath)
    } catch (e) {
      throw SkillError.filesystem(zipPath, e as Error)
    }
    const entries = zip.getEntries()
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new SkillError(
        `zip 条目数 ${entries.length} 超过上限 ${MAX_ZIP_ENTRIES}`,
        'FILESYSTEM',
      )
    }

    const ssotRoot = ssotRootOverride ?? defaultSsotRoot()
    const ssotResolved = resolve(ssotRoot)

    // 收集合法顶层目录名（拒绝空段 / '.' / '..'）。
    const topLevelDirs = new Set<string>()
    for (const entry of entries) {
      const first = entry.entryName.replace(/\\/g, '/').split('/')[0]
      if (!first || first === '.' || first === '..') continue
      topLevelDirs.add(first)
    }

    const now = Math.floor(Date.now() / 1000)
    const installed: InstalledSkill[] = []
    let totalBytes = 0

    for (const dirName of topLevelDirs) {
      const destPath = join(ssotRoot, dirName)
      const destResolved = resolve(destPath)
      // 防 dirName 仍含穿越：目标目录必须落在 SSOT root 内。
      if (destResolved !== ssotResolved && !destResolved.startsWith(ssotResolved + sep)) {
        continue
      }

      // 延迟到首次写文件时才建目录：顶层若是裸文件而非技能目录，不留空目录、不建空 skill。
      let wroteAny = false
      for (const entry of entries) {
        const norm = entry.entryName.replace(/\\/g, '/')
        if (entry.isDirectory || !norm.startsWith(`${dirName}/`)) continue
        const relPath = norm.slice(dirName.length + 1)
        if (!relPath) continue
        const outPath = resolve(destPath, relPath)
        // 逐条目边界校验：解压目标必须仍在该技能目录内（防 `../` 穿越）。
        if (outPath !== destResolved && !outPath.startsWith(destResolved + sep)) {
          continue
        }
        const data = entry.getData()
        totalBytes += data.length
        if (totalBytes > MAX_ZIP_BYTES) {
          throw new SkillError(`解压字节超过上限 ${MAX_ZIP_BYTES}`, 'FILESYSTEM')
        }
        try {
          mkdirSync(dirname(outPath), { recursive: true })
          writeFileSync(outPath, data)
          wroteAny = true
        } catch (e) {
          throw SkillError.filesystem(outPath, e as Error)
        }
      }

      // 顶层项下无任何有效文件（如 zip 顶层是裸文件而非技能目录）→ 跳过，不建空 skill 条目。
      if (!wroteAny) continue

      // 持久化入库（修复此前只返回不落库、重启即丢失的问题）；同名 directory 去重。
      const existing = await this.installedRepo.findByDirectory(dirName)
      if (existing) {
        existing.updated_at = now
        await this.installedRepo.save(existing)
        installed.push(existing)
        continue
      }
      const skill = InstalledSkill.create({
        id: randomUUID(),
        name: dirName,
        directory: dirName,
        apps: {},
        installed_at: now,
        updated_at: now,
        ssot_path: destPath,
        storage_location: 'haoxiaoguan',
      })
      await this.installedRepo.save(skill)
      installed.push(skill)
    }

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
