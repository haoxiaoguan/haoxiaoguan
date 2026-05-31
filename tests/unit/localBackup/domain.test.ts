// Unit tests for localBackup domain invariants.
// Pure — no Electron, no I/O.

import { describe, it, expect } from 'vitest'
import { LocalBackupConfig, RETAIN_MIN, RETAIN_MAX } from '@main/contexts/localBackup/domain/local-backup-config'
import { BackupEntry } from '@main/contexts/localBackup/domain/backup-entry'
import { BackupError } from '@main/contexts/localBackup/domain/backup-error'

describe('LocalBackupConfig', () => {
  it('uses defaults when constructed from empty object', () => {
    const cfg = LocalBackupConfig.fromJson({})
    expect(cfg.intervalHours).toBe(6)
    expect(cfg.retainCount).toBe(12)
  })

  it('clamps retainCount below minimum to 1', () => {
    const cfg = LocalBackupConfig.fromJson({ retainCount: 0 })
    expect(cfg.retainCount).toBe(RETAIN_MIN)
  })

  it('clamps retainCount above maximum to 50', () => {
    const cfg = LocalBackupConfig.fromJson({ retainCount: 999 })
    expect(cfg.retainCount).toBe(RETAIN_MAX)
  })

  it('accepts retainCount at boundary values', () => {
    expect(LocalBackupConfig.fromJson({ retainCount: 1 }).retainCount).toBe(1)
    expect(LocalBackupConfig.fromJson({ retainCount: 50 }).retainCount).toBe(50)
  })

  it('preserves intervalHours = 0 (disables auto-backup)', () => {
    const cfg = LocalBackupConfig.fromJson({ intervalHours: 0 })
    expect(cfg.intervalHours).toBe(0)
  })

  it('round-trips through toJson/fromJson', () => {
    const original = LocalBackupConfig.fromJson({ intervalHours: 12, retainCount: 20 })
    const roundTripped = LocalBackupConfig.fromJson(original.toJson())
    expect(roundTripped.intervalHours).toBe(12)
    expect(roundTripped.retainCount).toBe(20)
  })

  it('static defaults() returns default values', () => {
    const cfg = LocalBackupConfig.defaults()
    expect(cfg.intervalHours).toBe(6)
    expect(cfg.retainCount).toBe(12)
  })
})

describe('BackupEntry', () => {
  it('stores all fields correctly', () => {
    const entry = BackupEntry.create('db_backup_20260530_142305.db', 2048, 1_730_000_000)
    expect(entry.filename).toBe('db_backup_20260530_142305.db')
    expect(entry.sizeBytes).toBe(2048)
    expect(entry.createdAt).toBe(1_730_000_000)
  })

  it('toJson serialises with camelCase keys', () => {
    const entry = BackupEntry.create('db_backup_20260530_142305.db', 2048, 1_730_000_000)
    const json = entry.toJson()
    expect(json).toHaveProperty('filename', 'db_backup_20260530_142305.db')
    expect(json).toHaveProperty('sizeBytes', 2048)
    expect(json).toHaveProperty('createdAt', 1_730_000_000)
    // Must NOT have snake_case keys
    expect(json).not.toHaveProperty('size_bytes')
    expect(json).not.toHaveProperty('created_at')
  })
})

describe('BackupError', () => {
  it('factory methods set kind correctly', () => {
    expect(BackupError.io('disk full').kind).toBe('Io')
    expect(BackupError.db('query failed').kind).toBe('Db')
    expect(BackupError.invalidFilename('../evil.db').kind).toBe('InvalidFilename')
    expect(BackupError.notFound('missing.db').kind).toBe('NotFound')
  })

  it('is an instance of Error', () => {
    expect(BackupError.io('x')).toBeInstanceOf(Error)
  })

  it('message includes kind and detail', () => {
    const err = BackupError.notFound('foo.db')
    expect(err.message).toContain('NotFound')
    expect(err.message).toContain('foo.db')
  })
})
