import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { findCodexStateDb, CodexStateDb } from '../../../src/main/contexts/sessions/infrastructure/codex-state-db'

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hxg-codexhome-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

// 造一个最小 threads 表(只含本功能用到的列)。
function seedDb(path: string, rows: Array<{ id: string; provider: string; rollout: string; archived?: number }>) {
  const db = new Database(path)
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, model_provider TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)`)
  const ins = db.prepare('INSERT INTO threads (id, rollout_path, model_provider, archived) VALUES (?,?,?,?)')
  for (const r of rows) ins.run(r.id, r.rollout, r.provider, r.archived ?? 0)
  db.close()
}

/** 造含 has_user_event / cwd 列的 threads 表 */
function seedDbFull(
  path: string,
  rows: Array<{ id: string; provider: string; rollout: string; archived?: number; hasUserEvent?: number; cwd?: string }>
) {
  const db = new Database(path)
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    model_provider TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER,
    cwd TEXT
  )`)
  const ins = db.prepare('INSERT INTO threads (id, rollout_path, model_provider, archived, has_user_event, cwd) VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(r.id, r.rollout, r.provider, r.archived ?? 0, r.hasUserEvent ?? null, r.cwd ?? null)
  db.close()
}

describe('findCodexStateDb', () => {
  it('找最新版本号的 state_N.sqlite', async () => {
    seedDb(join(home, 'state_3.sqlite'), [])
    seedDb(join(home, 'state_5.sqlite'), [])
    expect(findCodexStateDb(home)).toBe(join(home, 'state_5.sqlite'))
  })
  it('无库返回 undefined', () => {
    expect(findCodexStateDb(home)).toBeUndefined()
  })
})

describe('CodexStateDb', () => {
  // ── counts: 全量(不过滤 archived) ──────────────────────────────────────────

  it('counts: 全量统计包含 archived 行', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
      { id: 'b', provider: 'openai', rollout: '/r/b.jsonl' },
      { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl' },
      { id: 'd', provider: 'openai', rollout: '/r/d.jsonl', archived: 1 },  // archived 行也计入
    ])
    const db = new CodexStateDb(p)
    try {
      const counts = db.counts()
      // openai=3, hxg_x=1
      expect(counts).toEqual([
        { provider: 'openai', count: 3 },
        { provider: 'hxg_x', count: 1 },
      ])
    } finally { db.close() }
  })

  // ── provider 全量更新由 applyUpdates 覆盖(含 archived 行)——见下方 applyUpdates 用例 ──

  // ── hasColumn ──────────────────────────────────────────────────────────────

  it('hasColumn: 返回正确的真/假', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDbFull(p, [])
    const db = new CodexStateDb(p)
    try {
      expect(db.hasColumn('threads', 'model_provider')).toBe(true)
      expect(db.hasColumn('threads', 'has_user_event')).toBe(true)
      expect(db.hasColumn('threads', 'cwd')).toBe(true)
      expect(db.hasColumn('threads', 'nonexistent')).toBe(false)
    } finally { db.close() }
  })

  // ── applyUpdates: 三类更新 ─────────────────────────────────────────────────

  it('applyUpdates: provider+has_user_event+cwd 三类计数正确', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDbFull(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl', hasUserEvent: 0, cwd: '/old' },
      { id: 'b', provider: 'openai', rollout: '/r/b.jsonl', hasUserEvent: null, cwd: null },
      { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl', hasUserEvent: 1, cwd: '/c' },
      { id: 'd', provider: 'openai', rollout: '/r/d.jsonl', hasUserEvent: 1, cwd: '/d', archived: 1 }, // 归档行 provider 也应改(对齐 codex++ 不过滤 archived)
    ])
    const db = new CodexStateDb(p)
    try {
      const result = db.applyUpdates(
        'hxg_x',
        ['a', 'b'],                       // userEventThreadIds
        { a: '/new-cwd', b: '/cwd-b' },   // cwdByThreadId
      )
      // provider: a+b+d changed (3, 含 archived 的 d), c already hxg_x (0)
      expect(result.providerRows).toBe(3)
      // has_user_event: a(0→1) + b(null→1) = 2
      expect(result.userEventRows).toBe(2)
      // cwd: a(/old→/new-cwd) + b(null→/cwd-b) = 2
      expect(result.cwdRows).toBe(2)

      // Verify actual DB state
      const raw = new Database(p, { readonly: true })
      const rowA = raw.prepare('SELECT * FROM threads WHERE id=?').get('a') as {
        model_provider: string; has_user_event: number; cwd: string
      }
      raw.close()
      expect(rowA.model_provider).toBe('hxg_x')
      expect(rowA.has_user_event).toBe(1)
      expect(rowA.cwd).toBe('/new-cwd')
    } finally { db.close() }
  })

  it('applyUpdates: 无 has_user_event / cwd 列时不报错', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
    ])
    const db = new CodexStateDb(p)
    try {
      const result = db.applyUpdates('hxg_x', ['a'], { a: '/cwd' })
      expect(result.providerRows).toBe(1)
      expect(result.userEventRows).toBe(0)
      expect(result.cwdRows).toBe(0)
    } finally { db.close() }
  })

  // ── countUpdates ───────────────────────────────────────────────────────────

  it('countUpdates: 返回需要更新的总行数（只读）', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDbFull(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl', hasUserEvent: 0, cwd: '/old' },
      { id: 'b', provider: 'hxg_x', rollout: '/r/b.jsonl', hasUserEvent: 1, cwd: '/b' },
    ])
    const db = new CodexStateDb(p)
    try {
      // provider: a needs update (1)
      // has_user_event: a needs update (0→1) (1)
      // cwd: a needs update (/old→/new) (1)
      const count = db.countUpdates('hxg_x', ['a'], { a: '/new' })
      expect(count).toBe(3)
    } finally { db.close() }
  })

  it('hasThreadsTable:无 threads 表返回 false', async () => {
    const p = join(home, 'state_5.sqlite')
    const raw = new Database(p); raw.exec('CREATE TABLE other (x)'); raw.close()
    const db = new CodexStateDb(p)
    try { expect(db.hasThreadsTable()).toBe(false) } finally { db.close() }
  })
})
