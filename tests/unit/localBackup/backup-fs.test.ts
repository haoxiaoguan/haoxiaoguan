// Unit tests for localBackup infrastructure — filesystem operations.
// Uses real temp dirs (mkdtempSync) and cleans up in afterEach.
// No Electron, no MikroORM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validateFilename,
  listBackups,
  cleanupOldBackups,
  deleteBackup,
  renameBackup,
} from '@main/contexts/localBackup/infrastructure/backup-fs-service'
import { BackupError } from '@main/contexts/localBackup/domain/backup-error'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hxg-backup-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── validateFilename ──────────────────────────────────────────────────────────

describe('validateFilename', () => {
  it('accepts a valid backup filename', () => {
    expect(() => validateFilename('db_backup_20260530_142305.db')).not.toThrow()
  })

  it('rejects empty string', () => {
    expect(() => validateFilename('')).toThrow(BackupError)
  })

  it('rejects path traversal with ..', () => {
    expect(() => validateFilename('../evil.db')).toThrow(BackupError)
  })

  it('rejects forward slash', () => {
    expect(() => validateFilename('a/b.db')).toThrow(BackupError)
  })

  it('rejects backslash', () => {
    expect(() => validateFilename('a\\b.db')).toThrow(BackupError)
  })

  it('rejects non-.db extension', () => {
    expect(() => validateFilename('backup.txt')).toThrow(BackupError)
  })

  it('rejects absolute path', () => {
    expect(() => validateFilename('/abs.db')).toThrow(BackupError)
  })
})

// ── listBackups ───────────────────────────────────────────────────────────────

describe('listBackups', () => {
  it('returns empty array when directory does not exist', async () => {
    const nonExistent = join(tmpDir, 'no-such-dir')
    const result = await listBackups(nonExistent)
    expect(result).toEqual([])
  })

  it('returns only .db files', async () => {
    writeFileSync(join(tmpDir, 'db_backup_a.db'), 'aaa')
    writeFileSync(join(tmpDir, 'notes.json'), '{}')
    writeFileSync(join(tmpDir, 'readme.txt'), 'hi')
    const result = await listBackups(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('db_backup_a.db')
  })

  it('sorts by createdAt descending (newest first)', async () => {
    // Write files with a small delay to ensure different mtimes.
    writeFileSync(join(tmpDir, 'db_backup_old.db'), 'x')
    // Force different mtime by using utimes
    const { utimes } = await import('node:fs/promises')
    const oldTime = new Date(Date.now() - 5000)
    await utimes(join(tmpDir, 'db_backup_old.db'), oldTime, oldTime)
    writeFileSync(join(tmpDir, 'db_backup_new.db'), 'xx')

    const result = await listBackups(tmpDir)
    expect(result).toHaveLength(2)
    expect(result[0].filename).toBe('db_backup_new.db')
    expect(result[1].filename).toBe('db_backup_old.db')
  })

  it('includes correct sizeBytes', async () => {
    writeFileSync(join(tmpDir, 'db_backup_sized.db'), 'hello')
    const result = await listBackups(tmpDir)
    expect(result[0].sizeBytes).toBe(5)
  })
})

// ── cleanupOldBackups ─────────────────────────────────────────────────────────

describe('cleanupOldBackups', () => {
  it('keeps only the newest `retain` files', async () => {
    const { utimes } = await import('node:fs/promises')
    // Create 3 files with distinct mtimes
    for (let i = 1; i <= 3; i++) {
      const name = join(tmpDir, `db_backup_${i}.db`)
      writeFileSync(name, 'x')
      const t = new Date(Date.now() - (4 - i) * 2000)
      await utimes(name, t, t)
    }

    await cleanupOldBackups(tmpDir, 2)
    const remaining = await listBackups(tmpDir)
    expect(remaining).toHaveLength(2)
    // The oldest (db_backup_1.db) should be gone
    expect(remaining.map((e) => e.filename)).not.toContain('db_backup_1.db')
  })

  it('does nothing when count is within retain limit', async () => {
    writeFileSync(join(tmpDir, 'db_backup_a.db'), 'a')
    await cleanupOldBackups(tmpDir, 5)
    const remaining = await listBackups(tmpDir)
    expect(remaining).toHaveLength(1)
  })
})

// ── deleteBackup ──────────────────────────────────────────────────────────────

describe('deleteBackup', () => {
  it('removes the file', async () => {
    const name = 'db_backup_20260530_142305.db'
    writeFileSync(join(tmpDir, name), 'data')
    await deleteBackup(tmpDir, name)
    expect(existsSync(join(tmpDir, name))).toBe(false)
  })

  it('throws NotFound for missing file', async () => {
    await expect(deleteBackup(tmpDir, 'db_backup_missing.db')).rejects.toMatchObject({
      kind: 'NotFound',
    })
  })

  it('throws InvalidFilename for path traversal', async () => {
    await expect(deleteBackup(tmpDir, '../evil.db')).rejects.toMatchObject({
      kind: 'InvalidFilename',
    })
  })
})

// ── renameBackup ──────────────────────────────────────────────────────────────

describe('renameBackup', () => {
  it('renames the file and returns updated entry', async () => {
    const oldName = 'db_backup_20260530_142305.db'
    const newName = 'my_custom_backup.db'
    writeFileSync(join(tmpDir, oldName), 'content')

    const entry = await renameBackup(tmpDir, oldName, newName)
    expect(entry.filename).toBe(newName)
    expect(existsSync(join(tmpDir, newName))).toBe(true)
    expect(existsSync(join(tmpDir, oldName))).toBe(false)
  })

  it('throws NotFound when old file does not exist', async () => {
    await expect(renameBackup(tmpDir, 'db_backup_ghost.db', 'db_backup_new.db')).rejects.toMatchObject({
      kind: 'NotFound',
    })
  })

  it('throws InvalidFilename when new file already exists', async () => {
    writeFileSync(join(tmpDir, 'db_backup_a.db'), 'a')
    writeFileSync(join(tmpDir, 'db_backup_b.db'), 'b')
    await expect(renameBackup(tmpDir, 'db_backup_a.db', 'db_backup_b.db')).rejects.toMatchObject({
      kind: 'InvalidFilename',
    })
  })

  it('throws InvalidFilename for path traversal in new name', async () => {
    writeFileSync(join(tmpDir, 'db_backup_a.db'), 'a')
    await expect(renameBackup(tmpDir, 'db_backup_a.db', '../evil.db')).rejects.toMatchObject({
      kind: 'InvalidFilename',
    })
  })
})
