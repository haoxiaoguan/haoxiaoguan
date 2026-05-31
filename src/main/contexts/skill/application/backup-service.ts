// BackupService -- create/restore/delete JSON snapshot backups.
// Mirrors Rust modules::skill::application::backup_service.
// restore_backup only upserts the DB record -- does NOT restore filesystem files.

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { InstalledSkillRepository } from '../domain/installed-skill-repository'
import type { SkillBackupRepository } from '../domain/skill-backup-repository'
import { InstalledSkill } from '../domain/installed-skill'
import { SkillBackupEntry } from '../domain/skill-backup'
import { SkillError } from '../domain/skill-error'

function backupRoot(): string {
  return join(homedir(), '.haoxiaoguan', 'backups', 'skills')
}

export class BackupService {
  constructor(
    private readonly installedRepo: InstalledSkillRepository,
    private readonly backupRepo: SkillBackupRepository,
  ) {}

  async getBackups(): Promise<SkillBackupEntry[]> {
    return this.backupRepo.findAll()
  }

  async getBackupsForSkill(skillId: string): Promise<SkillBackupEntry[]> {
    return this.backupRepo.findBySkillId(skillId)
  }

  async createBackup(skillId: string): Promise<SkillBackupEntry> {
    const skill = await this.installedRepo.findById(skillId)
    if (!skill) throw SkillError.notFound(skillId)

    const backupId = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    let snapshotJson: string
    try {
      snapshotJson = JSON.stringify(skill.toJson())
    } catch (e) {
      throw SkillError.serialization(String(e))
    }

    const archivePath = join(backupRoot(), `${skill.directory}_${backupId}.json`)

    try {
      mkdirSync(dirname(archivePath), { recursive: true })
      writeFileSync(archivePath, snapshotJson, 'utf8')
    } catch (e) {
      throw SkillError.filesystem(archivePath, e as Error)
    }

    const entry = SkillBackupEntry.create({
      backup_id: backupId,
      skill_id: skillId,
      snapshot_json: snapshotJson,
      archive_path: archivePath,
      created_at: now,
    })

    await this.backupRepo.save(entry)
    return entry
  }

  async deleteBackup(backupId: string): Promise<void> {
    // Deletes DB record only -- does not delete the archive file (mirrors Rust)
    await this.backupRepo.delete(backupId)
  }

  async restoreBackup(backupId: string): Promise<InstalledSkill> {
    const backups = await this.backupRepo.findAll()
    const entry = backups.find((b) => b.backup_id === backupId)
    if (!entry) throw SkillError.notFound(`backup ${backupId}`)

    let skill: InstalledSkill
    try {
      const raw = JSON.parse(entry.snapshot_json) as Record<string, unknown>
      skill = InstalledSkill.fromJson(raw)
    } catch (e) {
      throw SkillError.serialization(String(e))
    }

    // Upsert the deserialized skill -- does NOT restore filesystem files
    await this.installedRepo.save(skill)
    return skill
  }
}
