import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { CodexSessionRepair } from '../../../src/main/contexts/sessions/application/codex-session-repair'

let home: string
let backups: string
const lifecycleCalls: string[] = []
const fakeLifecycle = {
  beforeWrite: async () => { lifecycleCalls.push('before'); return { restart: true } },
  afterWrite: async () => { lifecycleCalls.push('after') },
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'hxg-repair-'))
  backups = await mkdtemp(join(tmpdir(), 'hxg-repbak-'))
  lifecycleCalls.length = 0
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(backups, { recursive: true, force: true })
})

function seed(rows: Array<{ id: string; provider: string; rollout: string }>) {
  const p = join(home, 'state_5.sqlite')
  const db = new Database(p)
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, model_provider TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)`)
  const ins = db.prepare('INSERT INTO threads VALUES (?,?,?,0)')
  for (const r of rows) ins.run(r.id, r.rollout, r.provider)
  db.close()
  return p
}
function repair() {
  return new CodexSessionRepair(home, join(home, 'config.toml'), fakeLifecycle, async () => false, backups)
}

describe('CodexSessionRepair', () => {
  it('preview:available + counts + currentProvider + repairable', async () => {
    seed([{ id: 'a', provider: 'openai', rollout: '/r/a.jsonl' }, { id: 'c', provider: 'hxg_x', rollout: '/r/c.jsonl' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const pv = await repair().preview()
    expect(pv.available).toBe(true)
    expect(pv.currentProvider).toBe('hxg_x')
    expect(pv.repairable).toBe(1) // openai 那条
    expect(pv.counts).toEqual([{ provider: 'openai', count: 1 }, { provider: 'hxg_x', count: 1 }])
  })

  it('preview:无库 → available:false', async () => {
    expect((await repair().preview()).available).toBe(false)
  })

  it('repair:更新 SQLite + 改写 rollout + 停-写-启', async () => {
    const rolloutA = join(home, 'a.jsonl')
    await writeFile(rolloutA, JSON.stringify({ type: 'session_meta', payload: { id: 'a', model_provider: 'openai' } }))
    seed([{ id: 'a', provider: 'openai', rollout: rolloutA }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    expect(res.updatedThreads).toBe(1)
    expect(res.rewrittenRollouts).toBe(1)
    expect(lifecycleCalls).toEqual(['before', 'after'])
    // SQLite 改了
    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    expect((db.prepare('SELECT model_provider FROM threads WHERE id=?').get('a') as { model_provider: string }).model_provider).toBe('hxg_x')
    db.close()
    // rollout 改了
    expect(JSON.parse(await readFile(rolloutA, 'utf8')).payload.model_provider).toBe('hxg_x')
  })

  it('rollback:还原 SQLite 与 rollout', async () => {
    const rolloutA = join(home, 'a.jsonl')
    await writeFile(rolloutA, JSON.stringify({ type: 'session_meta', payload: { id: 'a', model_provider: 'openai' } }))
    seed([{ id: 'a', provider: 'openai', rollout: rolloutA }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const svc = repair()
    const res = await svc.repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    await svc.rollback(res.backupId)
    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    expect((db.prepare('SELECT model_provider FROM threads WHERE id=?').get('a') as { model_provider: string }).model_provider).toBe('openai')
    db.close()
    expect(JSON.parse(await readFile(rolloutA, 'utf8')).payload.model_provider).toBe('openai')
  })
})
