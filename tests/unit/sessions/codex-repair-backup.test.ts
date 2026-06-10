import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexRepairBackup } from '../../../src/main/contexts/sessions/infrastructure/codex-repair-backup'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hxg-bak-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('CodexRepairBackup', () => {
  it('备份 db 文件并可恢复', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'ORIGINAL')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [{ path: join(root, 'r.jsonl'), oldProvider: 'openai' }])
    expect(id).toMatch(/.+/)
    await writeFile(dbPath, 'MUTATED')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('ORIGINAL')
  })

  it('restoreDbOnly 删除修复期残留的 live -wal/-shm(防陈旧 WAL 重放损坏)', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'ORIGINAL') // 备份时无 wal/shm
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [])
    // 模拟修复期 better-sqlite3 写出的 live wal/shm + 主库被改
    await writeFile(dbPath, 'MUTATED')
    await writeFile(dbPath + '-wal', 'STALE-WAL-FRAMES')
    await writeFile(dbPath + '-shm', 'STALE-SHM')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('ORIGINAL')
    expect(existsSync(dbPath + '-wal')).toBe(false) // 残留 wal 已删,不会被重放
    expect(existsSync(dbPath + '-shm')).toBe(false)
  })

  it('restoreDbOnly 还原备份时刻存在的 -wal/-shm', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(dbPath + '-wal', 'BAK-WAL')
    await writeFile(dbPath + '-shm', 'BAK-SHM')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [])
    // 修复后:主库与 wal 都变了
    await writeFile(dbPath, 'DB2')
    await writeFile(dbPath + '-wal', 'LIVE-WAL')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('DB')
    expect(await readFile(dbPath + '-wal', 'utf8')).toBe('BAK-WAL') // 还原成备份时刻的 wal
    expect(await readFile(dbPath + '-shm', 'utf8')).toBe('BAK-SHM')
  })

  it('manifest 记录 rollout 旧值', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'X')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [{ path: '/r/a.jsonl', oldProvider: 'openai' }])
    const m = await backup.readManifest(id)
    expect(m.rollout).toEqual([{ path: '/r/a.jsonl', oldProvider: 'openai' }])
    expect(existsSync(join(root, 'backups', id, 'manifest.json'))).toBe(true)
  })
})
