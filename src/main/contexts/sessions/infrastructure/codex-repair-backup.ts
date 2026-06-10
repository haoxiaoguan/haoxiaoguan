import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface RolloutBackupEntry {
  path: string
  oldProvider?: string
}
export interface RepairManifest {
  dbPath: string
  rollout: RolloutBackupEntry[]
}

/** Codex 修复的写前备份:db 文件副本 + rollout 旧 provider 清单。供回滚。 */
export class CodexRepairBackup {
  constructor(
    private readonly baseDir: string,
    private readonly genId: () => string = randomUUID,
  ) {}

  /** 备份 db(+wal/shm)并落 manifest。返回 backupId。 */
  async capture(dbPath: string, rollout: RolloutBackupEntry[]): Promise<string> {
    const id = this.genId()
    const dir = join(this.baseDir, id)
    await mkdir(dir, { recursive: true })
    await copyFile(dbPath, join(dir, 'db.bak'))
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) await copyFile(dbPath + suffix, join(dir, 'db.bak' + suffix))
    }
    const manifest: RepairManifest = { dbPath, rollout }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return id
  }

  async readManifest(id: string): Promise<RepairManifest> {
    return JSON.parse(await readFile(join(this.baseDir, id, 'manifest.json'), 'utf8')) as RepairManifest
  }

  /** 只恢复 db 文件(回滚时配合 rollout 反写;rollout 反写由 repair service 用 manifest 驱动)。 */
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
}
