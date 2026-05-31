// LocalBackupApplicationService — use cases for the localBackup bounded context.
// Mirrors Rust LocalBackupService (application/backup_service.rs).
//
// Dependencies injected:
//   - liveDbPath: absolute path to haoxiaoguan.db (for VACUUM INTO and restore)
//   - backupDir: directory where .db snapshots are stored
//   - configAdapter: reads/writes LocalBackupConfig in settings.json
//
// The periodic timer (setInterval, 30 min) is wired in main.ts / container.ts,
// not here — this service is pure use-case logic.

import { BackupEntry } from '../domain/backup-entry'
import { stat, access } from 'node:fs/promises'
import { LocalBackupConfig } from '../domain/local-backup-config'
import { BackupError } from '../domain/backup-error'
import {
  listBackups,
  cleanupOldBackups,
  ensureBackupDir,
  deleteBackup,
  renameBackup,
  validateFilename,
} from '../infrastructure/backup-fs-service'
import { vacuumInto, dumpFull, applyFull } from '../infrastructure/db-archive-service'
import type { LocalBackupConfigAdapter } from '../infrastructure/local-backup-config-adapter'

export class LocalBackupApplicationService {
  constructor(
    private readonly liveDbPath: string,
    private readonly backupDir: string,
    private readonly configAdapter: LocalBackupConfigAdapter,
  ) {}

  // ── Config ──────────────────────────────────────────────────────────────────

  getConfig(): LocalBackupConfig {
    return this.configAdapter.getConfig()
  }

  async saveConfig(config: LocalBackupConfig): Promise<void> {
    await this.configAdapter.saveConfig(config)
  }

  // ── List ─────────────────────────────────────────────────────────────────────

  async listBackups(): Promise<BackupEntry[]> {
    return listBackups(this.backupDir)
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async createBackup(): Promise<BackupEntry> {
    const cfg = this.getConfig()
    await ensureBackupDir(this.backupDir)

    const filename = await this.uniqueFilename()
    const targetPath = `${this.backupDir}/${filename}`

    await vacuumInto(this.liveDbPath, targetPath)

    // Stat the new file to build the BackupEntry (mtime as createdAt).
    const meta = await stat(targetPath)
    const sizeBytes = meta.size
    const createdAt = Math.floor(meta.mtimeMs / 1000)

    // Prune old backups to retain_count.
    await cleanupOldBackups(this.backupDir, cfg.retainCount)

    return BackupEntry.create(filename, sizeBytes, createdAt)
  }

  // ── Restore ──────────────────────────────────────────────────────────────────

  /**
   * Restore from a snapshot:
   *   1. Validate filename.
   *   2. Create a safety snapshot of the current live DB.
   *   3. Dump all rows from the snapshot as INSERT SQL.
   *   4. Replay into the live DB (foreign_keys OFF, inside a transaction).
   * Returns the safety snapshot filename.
   */
  async restoreBackup(filename: string): Promise<string> {
    validateFilename(filename)
    const snapshotPath = `${this.backupDir}/${filename}`
    try {
      await access(snapshotPath)
    } catch {
      throw BackupError.notFound(filename)
    }

    // Safety snapshot first — if this fails, we abort before touching live data.
    const safety = await this.createBackup()

    // Dump from snapshot, apply to live.
    const sql = await dumpFull(snapshotPath)
    await applyFull(this.liveDbPath, sql)

    return safety.filename
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async deleteBackup(filename: string): Promise<void> {
    await deleteBackup(this.backupDir, filename)
  }

  // ── Rename ───────────────────────────────────────────────────────────────────

  /**
   * Rename a backup.
   * newName is the bare display name WITHOUT the .db suffix (matches Rust API).
   * The service appends .db internally.
   */
  async renameBackup(oldFilename: string, newName: string): Promise<BackupEntry> {
    const newFilename = `${newName}.db`
    return renameBackup(this.backupDir, oldFilename, newFilename)
  }

  // ── Periodic timer ───────────────────────────────────────────────────────────

  /**
   * Called by the 30-minute background timer.
   * Skips if intervalHours == 0 or if the latest backup is recent enough.
   */
  async periodicBackupIfNeeded(): Promise<void> {
    const cfg = this.getConfig()
    if (cfg.intervalHours === 0) return

    const backups = await this.listBackups()
    const latestCreatedAt = backups.length > 0 ? backups[0].createdAt : 0
    const nowSecs = Math.floor(Date.now() / 1000)
    const intervalSecs = cfg.intervalHours * 3600

    if (latestCreatedAt === 0 || nowSecs - latestCreatedAt > intervalSecs) {
      await this.createBackup()
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Generate a unique filename using local time: db_backup_YYYYMMDD_HHMMSS[_N].db
   * Mirrors Rust unique_filename using chrono::Local::now().
   */
  private async uniqueFilename(): Promise<string> {
    const stamp = localTimestamp()
    const base = `db_backup_${stamp}`
    let candidate = `${base}.db`
    let n = 1
    while (true) {
      try {
        await access(`${this.backupDir}/${candidate}`)
        // File exists — try next suffix.
        candidate = `${base}_${n}.db`
        n++
      } catch {
        // ENOENT — candidate is free.
        break
      }
    }
    return candidate
  }
}

/**
 * Format current local time as YYYYMMDD_HHMMSS.
 * Uses Intl.DateTimeFormat to get local-time components (mirrors chrono::Local::now()).
 */
function localTimestamp(): string {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}${get('second')}`
}
