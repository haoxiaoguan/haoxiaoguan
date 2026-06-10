import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexRepairBackup } from '../../../src/main/contexts/sessions/infrastructure/codex-repair-backup'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hxg-bak-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

// ── 原有回归用例(保留不变) ──────────────────────────────────────────────────

describe('CodexRepairBackup (原有回归)', () => {
  it('备份 db 文件并可恢复', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'ORIGINAL')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [{ path: join(root, 'r.jsonl'), originalSessionMetaLines: ['line1'] }])
    expect(id).toMatch(/.+/)
    await writeFile(dbPath, 'MUTATED')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('ORIGINAL')
  })

  it('restoreDbOnly 删除修复期残留的 live -wal/-shm(防陈旧 WAL 重放损坏)', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'ORIGINAL') // 备份时无 wal/shm
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
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
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(dbPath + '-wal', 'BAK-WAL')
    await writeFile(dbPath + '-shm', 'BAK-SHM')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    // 修复后:主库与 wal 都变了
    await writeFile(dbPath, 'DB2')
    await writeFile(dbPath + '-wal', 'LIVE-WAL')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('DB')
    expect(await readFile(dbPath + '-wal', 'utf8')).toBe('BAK-WAL') // 还原成备份时刻的 wal
    expect(await readFile(dbPath + '-shm', 'utf8')).toBe('BAK-SHM')
  })
})

// ── 新增用例 ─────────────────────────────────────────────────────────────────

describe('CodexRepairBackup (新签名 — home 参数)', () => {
  it('备份包含 config.toml 和 .codex-global-state.json', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"')
    await writeFile(join(home, '.codex-global-state.json'), '{"key":"val"}')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    const dir = join(root, 'backups', id)
    expect(existsSync(join(dir, 'db.bak'))).toBe(true)
    expect(existsSync(join(dir, 'config.toml'))).toBe(true)
    expect(await readFile(join(dir, 'config.toml'), 'utf8')).toBe('model_provider = "hxg_x"')
    expect(existsSync(join(dir, '.codex-global-state.json'))).toBe(true)
    expect(await readFile(join(dir, '.codex-global-state.json'), 'utf8')).toBe('{"key":"val"}')
  })

  it('备份含 .codex-global-state.json.bak(存在才复制)', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(join(home, '.codex-global-state.json.bak'), 'BACKUP-CONTENT')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    const dir = join(root, 'backups', id)
    expect(existsSync(join(dir, '.codex-global-state.json.bak'))).toBe(true)
    expect(await readFile(join(dir, '.codex-global-state.json.bak'), 'utf8')).toBe('BACKUP-CONTENT')
  })

  it('缺失的 config.toml 和 global-state 不报错', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    const dir = join(root, 'backups', id)
    expect(existsSync(join(dir, 'config.toml'))).toBe(false)
    expect(existsSync(join(dir, '.codex-global-state.json'))).toBe(false)
    expect(id).toMatch(/.+/)
  })

  it('备份含 session-meta-backup.json', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    const changedFiles = [
      { path: '/sessions/a.jsonl', originalSessionMetaLines: ['lineA1', 'lineA2'] },
      { path: '/sessions/b.jsonl', originalSessionMetaLines: ['lineB1'] },
    ]

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, changedFiles)
    const dir = join(root, 'backups', id)
    const sessionMeta = JSON.parse(await readFile(join(dir, 'session-meta-backup.json'), 'utf8')) as unknown[]
    expect(sessionMeta).toHaveLength(2)
    expect((sessionMeta[0] as { path: string }).path).toBe('/sessions/a.jsonl')
    expect((sessionMeta[0] as { originalSessionMetaLines: string[] }).originalSessionMetaLines).toEqual(['lineA1', 'lineA2'])
    expect((sessionMeta[1] as { path: string }).path).toBe('/sessions/b.jsonl')
  })

  it('备份含 manifest.json(含 dbPath 和 home)', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    const m = await backup.readManifest(id)
    expect(m.dbPath).toBe(dbPath)
    expect(m.home).toBe(home)
  })

  it('readSessionMetaBackup 读回 changedFiles', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    const changedFiles = [
      { path: '/sessions/x.jsonl', originalSessionMetaLines: ['origLine'] },
    ]

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, changedFiles)
    const entries = await backup.readSessionMetaBackup(id)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('/sessions/x.jsonl')
    expect(entries[0].originalSessionMetaLines).toEqual(['origLine'])
  })
})

describe('CodexRepairBackup.restoreConfigAndGlobalState', () => {
  it('还原 config.toml 和 .codex-global-state.json', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(join(home, 'config.toml'), 'ORIGINAL-TOML')
    await writeFile(join(home, '.codex-global-state.json'), 'ORIGINAL-GS')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])

    // 模拟修复后文件被改
    await writeFile(join(home, 'config.toml'), 'MUTATED-TOML')
    await writeFile(join(home, '.codex-global-state.json'), 'MUTATED-GS')

    await backup.restoreConfigAndGlobalState(id, home)
    expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe('ORIGINAL-TOML')
    expect(await readFile(join(home, '.codex-global-state.json'), 'utf8')).toBe('ORIGINAL-GS')
  })

  it('还原 .codex-global-state.json.bak(若备份时存在)', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    await writeFile(join(home, '.codex-global-state.json.bak'), 'ORIGINAL-BAK')

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])

    await writeFile(join(home, '.codex-global-state.json.bak'), 'MUTATED-BAK')
    await backup.restoreConfigAndGlobalState(id, home)
    expect(await readFile(join(home, '.codex-global-state.json.bak'), 'utf8')).toBe('ORIGINAL-BAK')
  })

  it('备份时不存在的文件，还原时不拷(无错)', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    // config.toml 不存在

    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(home, dbPath, [])
    // 还原不应报错
    await expect(backup.restoreConfigAndGlobalState(id, home)).resolves.not.toThrow()
    expect(existsSync(join(home, 'config.toml'))).toBe(false)
  })
})

describe('CodexRepairBackup.prune', () => {
  it('保留最近 N 个，删除较旧的', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    const backup = new CodexRepairBackup(join(root, 'backups'))

    // 依序创建 7 个备份
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      const id = await backup.capture(home, dbPath, [])
      ids.push(id)
      // 小延迟保证 mtime 有序
      await new Promise((r) => setTimeout(r, 5))
    }

    await backup.prune(5)

    // 最新 5 个保留
    const kept = ids.slice(-5)
    const pruned = ids.slice(0, 2)
    for (const id of kept) {
      expect(existsSync(join(root, 'backups', id))).toBe(true)
    }
    for (const id of pruned) {
      expect(existsSync(join(root, 'backups', id))).toBe(false)
    }
  })

  it('prune(5) 在备份数 <= 5 时不删任何目录', async () => {
    const home = join(root, 'home')
    await mkdir(home, { recursive: true })
    const dbPath = join(home, 'state_5.sqlite')
    await writeFile(dbPath, 'DB')
    const backup = new CodexRepairBackup(join(root, 'backups'))

    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      ids.push(await backup.capture(home, dbPath, []))
      await new Promise((r) => setTimeout(r, 5))
    }

    await backup.prune(5)
    for (const id of ids) {
      expect(existsSync(join(root, 'backups', id))).toBe(true)
    }
  })

  it('baseDir 不存在时 prune 不报错', async () => {
    const backup = new CodexRepairBackup(join(root, 'nonexistent'))
    await expect(backup.prune(5)).resolves.not.toThrow()
  })
})
