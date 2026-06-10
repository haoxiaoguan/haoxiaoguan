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
  it('counts:按 provider 聚合,跳过 archived', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
      { id: 'b', provider: 'openai', rollout: '/r/b.jsonl' },
      { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl' },
      { id: 'd', provider: 'openai', rollout: '/r/d.jsonl', archived: 1 },
    ])
    const db = new CodexStateDb(p)
    try {
      expect(db.counts()).toEqual([
        { provider: 'openai', count: 2 },
        { provider: 'hxg_x', count: 1 },
      ])
    } finally { db.close() }
  })

  it('listRefs:返回非 target 且非 archived 的 thread', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
      { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl' },
    ])
    const db = new CodexStateDb(p)
    try {
      expect(db.listRefs('hxg_x')).toEqual([{ id: 'a', rolloutPath: '/r/a.jsonl', provider: 'openai' }])
    } finally { db.close() }
  })

  it('updateProvider:把非 target 改成 target,返回改动行数', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
      { id: 'b', provider: 'custom', rollout: '/r/b.jsonl' },
      { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl' },
    ])
    const db = new CodexStateDb(p)
    try {
      expect(db.updateProvider('hxg_x')).toBe(2)
      expect(db.counts()).toEqual([{ provider: 'hxg_x', count: 3 }])
    } finally { db.close() }
  })

  it('updateProvider 带 fromProviders 限定', async () => {
    const p = join(home, 'state_5.sqlite')
    seedDb(p, [
      { id: 'a', provider: 'openai', rollout: '/r/a.jsonl' },
      { id: 'b', provider: 'custom', rollout: '/r/b.jsonl' },
    ])
    const db = new CodexStateDb(p)
    try {
      expect(db.updateProvider('hxg_x', ['openai'])).toBe(1)
    } finally { db.close() }
  })

  it('hasThreadsTable:无 threads 表返回 false', async () => {
    const p = join(home, 'state_5.sqlite')
    const raw = new Database(p); raw.exec('CREATE TABLE other (x)'); raw.close()
    const db = new CodexStateDb(p)
    try { expect(db.hasThreadsTable()).toBe(false) } finally { db.close() }
  })
})
