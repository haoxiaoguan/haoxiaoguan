// registerSkillHandlers -- wires all 23 skill IPC channels.
// Channel names come from SKILL_CHANNELS in src/shared/ipc-channels.ts.
// Arg/return shapes are fixed by the frontend contract (map_skill.md).
//
// Arg casing rules (from CONVENTIONS.md §3 + design spec §2.1):
//   - Top-level args: camelCase  (skillId, backupId, zipPath, agentId, target, method, location)
//   - Channels with a `request` wrapper: inner fields are snake_case
//     (install_skill_unified, toggle_skill_app, search_skills_sh,
//      add_skill_repo, remove_skill_repo, import_skills_from_apps)
//
// Return casing: snake_case for skill context.

import { ipcMain } from 'electron'
import { dialog } from 'electron'
import AdmZip from 'adm-zip'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { toIpcError } from '../../../ipc/error'
import { SKILL_CHANNELS } from '../../../../shared/ipc-channels'
import type { SkillApplicationService } from '../application/skill-application-service'
import type { DiscoveryService } from '../application/discovery-service'
import type { BackupService } from '../application/backup-service'
import type { StorageService } from '../application/storage-service'
import { SkillRepo } from '../domain/skill-repo'
import { parseAgentId } from '../../../agents/domain/agent-id'
import { defaultSsotRoot } from '../application/skill-application-service'
import { InstalledSkill } from '../domain/installed-skill'

export interface SkillServices {
  skillService: SkillApplicationService
  discoveryService: DiscoveryService
  backupService: BackupService
  storageService: StorageService
}

// DTOs matching the frontend contract exactly
interface InstallSkillRequest {
  name: string
  description?: string
  directory: string
  repo_owner: string
  repo_name: string
  repo_branch: string
  readme_url?: string
  agent_id: string
}

interface ToggleSkillAppRequest {
  skill_id: string
  agent_id: string
  enabled: boolean
}

interface SearchSkillsShRequest {
  query: string
  limit?: number
  offset?: number
}

interface AddSkillRepoRequest {
  owner: string
  name: string
  branch: string
}

interface RemoveSkillRepoRequest {
  owner: string
  name: string
}

interface ImportFromAppsRequest {
  agent_id: string
  dir_names: string[]
}

export function registerSkillHandlers(services: SkillServices): void {
  const { skillService, discoveryService, backupService, storageService } = services

  // 1. get_installed_skills
  ipcMain.handle(SKILL_CHANNELS.getInstalledSkills, async () => {
    try {
      const skills = await skillService.getInstalled()
      return skills.map((s) => s.toJson())
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 2. install_skill_unified -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.installSkillUnified, async (_e, req: InstallSkillRequest) => {
    try {
      const agentId = parseAgentId(req.agent_id)
      const skill = await skillService.install(
        {
          name: req.name,
          description: req.description,
          directory: req.directory,
          repo_owner: req.repo_owner,
          repo_name: req.repo_name,
          repo_branch: req.repo_branch,
          readme_url: req.readme_url,
        },
        agentId,
      )
      return skill.toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 3. uninstall_skill_unified -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.uninstallSkillUnified, async (_e, skillId: string) => {
    try {
      return await skillService.uninstall(skillId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 4. toggle_skill_app -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.toggleSkillApp, async (_e, req: ToggleSkillAppRequest) => {
    try {
      const agentId = parseAgentId(req.agent_id)
      return await skillService.toggleApp(req.skill_id, agentId, req.enabled)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 5. update_skill -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.updateSkill, async (_e, skillId: string) => {
    try {
      const skill = await skillService.update(skillId)
      return skill.toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 6. check_skill_updates -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.checkSkillUpdates, async (_e, skillId: string) => {
    try {
      const hasUpdate = await skillService.checkUpdates(skillId)
      return { has_update: hasUpdate }
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 7. get_skill_backups
  ipcMain.handle(SKILL_CHANNELS.getSkillBackups, async () => {
    try {
      return await backupService.getBackups()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 8. delete_skill_backup -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.deleteSkillBackup, async (_e, backupId: string) => {
    try {
      await backupService.deleteBackup(backupId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 9. restore_skill_backup -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.restoreSkillBackup, async (_e, backupId: string) => {
    try {
      const skill = await backupService.restoreBackup(backupId)
      return skill.toJson()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 10. discover_available_skills
  ipcMain.handle(SKILL_CHANNELS.discoverAvailableSkills, async () => {
    try {
      return await discoveryService.discoverAvailable()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 11. search_skills_sh -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.searchSkillsSh, async (_e, req: SearchSkillsShRequest) => {
    try {
      return await discoveryService.searchSkillsSh(
        req.query,
        req.limit ?? 20,
        req.offset ?? 0,
      )
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 12. get_skill_repos
  ipcMain.handle(SKILL_CHANNELS.getSkillRepos, async () => {
    try {
      const repos = await discoveryService.getRepos()
      return repos.map((r) => ({
        owner: r.owner,
        name: r.name,
        branch: r.branch,
        enabled: r.enabled,
        sort_order: r.sort_order,
        added_at: r.added_at,
      }))
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 13. add_skill_repo -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.addSkillRepo, async (_e, req: AddSkillRepoRequest) => {
    try {
      const now = Math.floor(Date.now() / 1000)
      const repo = SkillRepo.create({
        owner: req.owner,
        name: req.name,
        branch: req.branch,
        enabled: true,
        sort_order: 99,
        added_at: now,
      })
      await discoveryService.addRepo(repo)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 14. remove_skill_repo -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.removeSkillRepo, async (_e, req: RemoveSkillRepoRequest) => {
    try {
      await discoveryService.removeRepo(req.owner, req.name)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 15. scan_unmanaged_skills -- top-level camelCase arg
  ipcMain.handle(SKILL_CHANNELS.scanUnmanagedSkills, async (_e, agentId: string) => {
    try {
      const agent = parseAgentId(agentId)
      return await skillService.scanUnmanaged(agent)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 16. import_skills_from_apps -- request wrapper with snake_case inner fields
  ipcMain.handle(SKILL_CHANNELS.importSkillsFromApps, async (_e, req: ImportFromAppsRequest) => {
    try {
      const agent = parseAgentId(req.agent_id)
      const skills = await skillService.importFromAgent(agent, req.dir_names)
      return skills.map((s) => s.toJson())
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 17. open_zip_file_dialog -- Electron dialog implementation (was Tauri TODO stub)
  ipcMain.handle(SKILL_CHANNELS.openZipFileDialog, async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 18. install_skills_from_zip -- Electron adm-zip implementation (was Tauri TODO stub)
  ipcMain.handle(SKILL_CHANNELS.installSkillsFromZip, async (_e, zipPath: string) => {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      const ssotRoot = defaultSsotRoot()
      const installed: ReturnType<InstalledSkill['toJson']>[] = []

      // Extract each top-level directory as a skill
      const topLevelDirs = new Set<string>()
      for (const entry of entries) {
        const parts = entry.entryName.split('/')
        if (parts[0]) topLevelDirs.add(parts[0])
      }

      for (const dirName of topLevelDirs) {
        const destPath = join(ssotRoot, dirName)
        mkdirSync(destPath, { recursive: true })
        // Extract only entries under this dir
        for (const entry of entries) {
          if (entry.entryName.startsWith(`${dirName}/`) && !entry.isDirectory) {
            const relPath = entry.entryName.slice(dirName.length + 1)
            if (relPath) {
              zip.extractEntryTo(entry, destPath, false, true)
            }
          }
        }

        const now = Math.floor(Date.now() / 1000)
        const id = randomUUID()
        const apps: Record<string, boolean> = {}
        const skill = InstalledSkill.create({
          id,
          name: dirName,
          directory: dirName,
          apps,
          installed_at: now,
          updated_at: now,
          ssot_path: destPath,
          storage_location: 'haoxiaoguan',
        })
        installed.push(skill.toJson())
      }

      return installed
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 19. migrate_skill_storage -- TODO stub (mirrors Rust no-op)
  ipcMain.handle(SKILL_CHANNELS.migrateSkillStorage, async (_e, skillId: string, target: string) => {
    try {
      await storageService.migrateSkill(skillId, target)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 20. get_skill_storage_location
  ipcMain.handle(SKILL_CHANNELS.getSkillStorageLocation, async () => {
    try {
      return storageService.getStorageLocation()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 21. set_skill_storage_location -- TODO stub (mirrors Rust no-op)
  ipcMain.handle(SKILL_CHANNELS.setSkillStorageLocation, async (_e, location: string) => {
    try {
      await storageService.setStorageLocation(location)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 22. get_skill_sync_method -- always returns 'auto' (mirrors Rust hardcoded)
  ipcMain.handle(SKILL_CHANNELS.getSkillSyncMethod, async () => {
    try {
      return 'auto'
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 23. set_skill_sync_method -- TODO stub (mirrors Rust no-op)
  ipcMain.handle(SKILL_CHANNELS.setSkillSyncMethod, async (_e, _method: string) => {
    try {
      // stub -- intended to persist sync method to settings
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
