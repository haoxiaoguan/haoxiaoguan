// MikroORM-backed implementation of SkillBackupRepository.
// Uses raw SQL via the underlying connection (no entity class imports).
// findAll returns rows ordered by created_at DESC.
// Accepts an optional getEm factory for testability.

import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { SkillBackupRepository } from '../domain/skill-backup-repository'
import { SkillBackupEntry } from '../domain/skill-backup'

interface BackupRow {
  backup_id: string
  skill_id: string
  snapshot_json: string
  archive_path: string
  created_at: number
}

function rowToDomain(row: BackupRow): SkillBackupEntry {
  return SkillBackupEntry.create({
    backup_id: row.backup_id,
    skill_id: row.skill_id,
    snapshot_json: row.snapshot_json,
    archive_path: row.archive_path,
    created_at: Number(row.created_at),
  })
}

export class MikroOrmSkillBackupRepository implements SkillBackupRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async findAll(): Promise<SkillBackupEntry[]> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM skill_backups ORDER BY created_at DESC') as BackupRow[]
    return rows.map(rowToDomain)
  }

  async findBySkillId(skillId: string): Promise<SkillBackupEntry[]> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute(
      'SELECT * FROM skill_backups WHERE skill_id = ? ORDER BY created_at DESC',
      [skillId],
    ) as BackupRow[]
    return rows.map(rowToDomain)
  }

  async save(entry: SkillBackupEntry): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      `INSERT INTO skill_backups (backup_id, skill_id, snapshot_json, archive_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [entry.backup_id, entry.skill_id, entry.snapshot_json, entry.archive_path, entry.created_at],
    )
  }

  async delete(backupId: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM skill_backups WHERE backup_id = ?', [backupId])
  }
}
