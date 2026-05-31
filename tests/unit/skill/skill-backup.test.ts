// Unit tests for SkillBackupEntry domain entity invariants.

import { describe, it, expect } from 'vitest'
import { SkillBackupEntry } from '../../../src/main/contexts/skill/domain/skill-backup'

describe('SkillBackupEntry', () => {
  it('creates with all fields', () => {
    const e = SkillBackupEntry.create({
      backup_id: 'bid-1',
      skill_id: 'sid-1',
      snapshot_json: '{}',
      archive_path: '/tmp/backup.json',
      created_at: 9999,
    })
    expect(e.backup_id).toBe('bid-1')
    expect(e.skill_id).toBe('sid-1')
    expect(e.created_at).toBe(9999)
  })

  it('throws when backup_id is empty', () => {
    expect(() =>
      SkillBackupEntry.create({ backup_id: '', skill_id: 's', snapshot_json: '{}', archive_path: '/p', created_at: 1 }),
    ).toThrow('backup_id is required')
  })

  it('throws when snapshot_json is empty', () => {
    expect(() =>
      SkillBackupEntry.create({ backup_id: 'b', skill_id: 's', snapshot_json: '', archive_path: '/p', created_at: 1 }),
    ).toThrow('snapshot_json is required')
  })
})
