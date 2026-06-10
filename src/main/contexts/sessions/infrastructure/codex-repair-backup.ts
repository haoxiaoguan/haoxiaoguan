import { mkdir, copyFile, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface SessionMetaBackupEntry {
  path: string
  originalSessionMetaLines: string[]
}

export interface RepairManifest {
  dbPath: string
  home: string
}

/** Codex 修复的写前备份，对齐 Rust create_backup。供回滚。 */
export class CodexRepairBackup {
  constructor(
    private readonly baseDir: string,
    private readonly genId: () => string = randomUUID,
  ) {}

  /**
   * 备份 db(+wal/shm)+ home/config.toml + home/.codex-global-state.json[.bak]
   * + session-meta-backup.json + manifest.json。返回 backupId。
   * 备份完成后自动调用 prune(5)。
   *
   * 保留原有写前删 stale-wal 逻辑（restoreDbOnly 侧）。
   */
  async capture(
    home: string,
    dbPath: string,
    changedFiles: SessionMetaBackupEntry[],
  ): Promise<string> {
    const id = this.genId()
    const dir = join(this.baseDir, id)
    await mkdir(dir, { recursive: true })

    // db + wal/shm
    await copyFile(dbPath, join(dir, 'db.bak'))
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) {
        await copyFile(dbPath + suffix, join(dir, 'db.bak' + suffix))
      }
    }

    // config.toml, .codex-global-state.json, .codex-global-state.json.bak
    for (const name of ['config.toml', '.codex-global-state.json', '.codex-global-state.json.bak']) {
      const src = join(home, name)
      if (existsSync(src)) {
        await copyFile(src, join(dir, name))
      }
    }

    // session-meta-backup.json
    await writeFile(join(dir, 'session-meta-backup.json'), JSON.stringify(changedFiles, null, 2))

    // manifest.json
    const manifest: RepairManifest = { dbPath, home }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    await this.prune(5)
    return id
  }

  async readManifest(id: string): Promise<RepairManifest> {
    return JSON.parse(await readFile(join(this.baseDir, id, 'manifest.json'), 'utf8')) as RepairManifest
  }

  async readSessionMetaBackup(id: string): Promise<SessionMetaBackupEntry[]> {
    return JSON.parse(
      await readFile(join(this.baseDir, id, 'session-meta-backup.json'), 'utf8'),
    ) as SessionMetaBackupEntry[]
  }

  /**
   * 只恢复 db 文件(回滚时配合 rollout 反写;rollout 反写由 repair service 用 manifest 驱动)。
   * 保留原有写前删 stale-wal 逻辑：防修复期产生的 WAL 残留被重放。
   */
  async restoreDbOnly(id: string, dbPath: string): Promise<void> {
    const dir = join(this.baseDir, id)
    // 先删修复期间产生的 live WAL/SHM:否则拷回旧主库后,残留的修复期 WAL 会被 SQLite
    // 下次打开时重放——轻则把修复改动重新应用(回滚失效),重则与还原后的主库页/salt 不一致损坏库。
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) await rm(dbPath + suffix, { force: true })
    }
    await copyFile(join(dir, 'db.bak'), dbPath)
    // 再还原备份时刻的 WAL/SHM(与 db.bak 同一时刻、内部一致);备份时无则保持无 WAL。
    for (const suffix of ['-wal', '-shm']) {
      const src = join(dir, 'db.bak' + suffix)
      if (existsSync(src)) await copyFile(src, dbPath + suffix)
    }
  }

  /**
   * 还原 config.toml / .codex-global-state.json / .codex-global-state.json.bak。
   * 备份时存在才拷，不存在的文件不还原（不删除目标侧已有文件）。
   */
  async restoreConfigAndGlobalState(id: string, home: string): Promise<void> {
    const dir = join(this.baseDir, id)
    for (const name of ['config.toml', '.codex-global-state.json', '.codex-global-state.json.bak']) {
      const src = join(dir, name)
      if (existsSync(src)) {
        await copyFile(src, join(home, name))
      }
    }
  }

  /**
   * 对齐 Rust prune_backups:baseDir 下子目录按 mtime 倒序保留最近 keep 个，余删。
   */
  async prune(keep = 5): Promise<void> {
    if (!existsSync(this.baseDir)) return
    const entries = await readdir(this.baseDir)
    const dirs: Array<{ name: string; mtimeMs: number }> = []
    for (const name of entries) {
      const p = join(this.baseDir, name)
      try {
        const s = await stat(p)
        if (s.isDirectory()) {
          dirs.push({ name, mtimeMs: s.mtimeMs })
        }
      } catch {
        // ignore unreadable entries
      }
    }
    // 按 mtime 倒序(最新在前)
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const toDelete = dirs.slice(keep)
    for (const entry of toDelete) {
      try {
        await rm(join(this.baseDir, entry.name), { recursive: true, force: true })
      } catch {
        // best effort
      }
    }
  }
}
