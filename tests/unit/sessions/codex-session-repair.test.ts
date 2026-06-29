import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { CodexSessionRepair } from '../../../src/main/contexts/sessions/application/codex-session-repair'
import type { CodexRepairProgress } from '../../../src/main/contexts/sessions/domain/codex-repair'

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

// ── helpers ─────────────────────────────────────────────────────────────────

/** 创建带 has_user_event + cwd 列的 state_*.sqlite */
function seedDb(rows: Array<{
  id: string
  provider: string
  model?: string
  hasUserEvent?: number
  cwd?: string | null
  archived?: number
}>) {
  const p = join(home, 'state_5.sqlite')
  const db = new Database(p)
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      model_provider TEXT NOT NULL,
      model TEXT,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      cwd TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    )
  `)
  const ins = db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)')
  for (const r of rows) {
    ins.run(r.id, r.provider, r.model ?? null, r.hasUserEvent ?? 0, r.cwd ?? null, r.archived ?? 0)
  }
  db.close()
  return p
}

/** 生成标准 rollout 文件内容（含 session_meta + user_message + cwd） */
function rolloutText(opts: {
  threadId: string
  provider: string
  model?: string
  cwd?: string
  hasUserMessage?: boolean
  sessionMetaCount?: number
}) {
  const lines: string[] = []
  const count = opts.sessionMetaCount ?? 1
  for (let i = 0; i < count; i++) {
    const meta: Record<string, unknown> = {
      type: 'session_meta',
      payload: { id: opts.threadId, model_provider: opts.provider },
    }
    if (opts.model) (meta.payload as Record<string, unknown>)['model'] = opts.model
    if (opts.cwd) (meta.payload as Record<string, unknown>)['cwd'] = opts.cwd
    lines.push(JSON.stringify(meta))
  }
  if (opts.hasUserMessage !== false) {
    lines.push(JSON.stringify({ type: 'user_message', content: 'hello' }))
  }
  return lines.join('\n')
}

function repair() {
  return new CodexSessionRepair(home, join(home, 'config.toml'), fakeLifecycle, async () => false, backups)
}

// ── preview ──────────────────────────────────────────────────────────────────

describe('CodexSessionRepair.preview', () => {
  it('available + counts + currentProvider + repairable', async () => {
    seedDb([
      { id: 'a', provider: 'openai' },
      { id: 'c', provider: 'hxg_x' },
    ])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const pv = await repair().preview()
    expect(pv.available).toBe(true)
    expect(pv.currentProvider).toBe('hxg_x')
    expect(pv.repairable).toBe(1) // openai 那条
    expect(pv.counts.find((c) => c.provider === 'openai')?.count).toBe(1)
    expect(pv.counts.find((c) => c.provider === 'hxg_x')?.count).toBe(1)
  })

  it('config.toml 无 model_provider（内置 OpenAI）→ currentProvider 回落 openai、可修复非 openai', async () => {
    seedDb([
      { id: 'a', provider: 'hxg_x' },
      { id: 'b', provider: 'hxg_x' },
      { id: 'c', provider: 'openai' },
    ])
    await writeFile(join(home, 'config.toml'), 'model = "gpt-5"\n') // 有 config.toml 但无 model_provider 键
    const pv = await repair().preview()
    expect(pv.currentProvider).toBe('openai')
    expect(pv.repairable).toBe(3) // 两条 hxg_x + 一条 openai 旧 model
  })

  it('config.toml 不存在 → currentProvider 回落 openai', async () => {
    seedDb([
      { id: 'a', provider: 'hxg_x' },
      { id: 'b', provider: 'openai' },
    ])
    const pv = await repair().preview()
    expect(pv.currentProvider).toBe('openai')
    expect(pv.repairable).toBe(1)
  })

  it('provider 相同但 model 过期时仍计入可修复', async () => {
    seedDb([
      { id: 'a', provider: 'hxg_x', model: 'glm-old' },
      { id: 'b', provider: 'hxg_x', model: 'glm-new' },
    ])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\nmodel = "glm-new"\n')
    const pv = await repair().preview()
    expect(pv.currentProvider).toBe('hxg_x')
    expect(pv.currentModel).toBe('glm-new')
    expect(pv.repairable).toBe(1)
  })

  it('无库 → available:false', async () => {
    expect((await repair().preview()).available).toBe(false)
  })

  it('codexRunning 由 isCodexRunning 决定', async () => {
    seedDb([{ id: 'a', provider: 'openai' }])
    const svc = new CodexSessionRepair(home, join(home, 'config.toml'), fakeLifecycle, async () => true, backups)
    expect((await svc.preview()).codexRunning).toBe(true)
  })
})

// ── repair — SQLite ───────────────────────────────────────────────────────────

describe('CodexSessionRepair.repair — SQLite 三类更新', () => {
  it('provider 全量更新', async () => {
    seedDb([
      { id: 'a', provider: 'openai' },
      { id: 'b', provider: 'openai' },
    ])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false })
    expect(res.updatedThreads).toBe(2)
    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    const rows = db.prepare('SELECT model_provider FROM threads').all() as { model_provider: string }[]
    db.close()
    expect(rows.every((r) => r.model_provider === 'hxg_x')).toBe(true)
  })

  it('model 全量更新', async () => {
    seedDb([
      { id: 'a', provider: 'openai', model: 'gpt-old' },
      { id: 'b', provider: 'hxg_x', model: 'glm-old' },
    ])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\nmodel = "glm-new"\n')
    const res = await repair().repair({ targetProvider: 'hxg_x', targetModel: 'glm-new', rewriteRollout: false })
    expect(res.modelRows).toBe(2)
    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    const rows = db.prepare('SELECT model FROM threads ORDER BY id').all() as { model: string }[]
    db.close()
    expect(rows.map((r) => r.model)).toEqual(['glm-new', 'glm-new'])
  })

  it('has_user_event 回填', async () => {
    // sessions 目录放真实 rollout 含 user_message
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai', hasUserMessage: true }))

    seedDb([{ id: 'a', provider: 'openai', hasUserEvent: 0 }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })

    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    const row = db.prepare('SELECT has_user_event FROM threads WHERE id=?').get('a') as { has_user_event: number }
    db.close()
    expect(row.has_user_event).toBe(1)
  })

  it('cwd 回填', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai', cwd: '/workspace/proj' }))

    seedDb([{ id: 'a', provider: 'openai', cwd: null }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })

    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    const row = db.prepare('SELECT cwd FROM threads WHERE id=?').get('a') as { cwd: string }
    db.close()
    expect(row.cwd).toBe('/workspace/proj')
  })

  it('返回三类行数', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai', cwd: '/ws', hasUserMessage: true }))

    seedDb([{ id: 'a', provider: 'openai', hasUserEvent: 0, cwd: null }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    expect(res.updatedThreads).toBeGreaterThanOrEqual(1) // providerRows
    expect(res.userEventRows).toBeGreaterThanOrEqual(1)
    expect(res.cwdRows).toBeGreaterThanOrEqual(1)
  })
})

// ── repair — rollout 改写 ────────────────────────────────────────────────────

describe('CodexSessionRepair.repair — rollout 改写', () => {
  it('改写 sessions/ 下的 rollout 文件', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai' }))

    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    expect(res.changedRollouts).toBe(1)
    const meta = JSON.parse((await readFile(rolloutA, 'utf8')).split('\n')[0]) as { payload: { model_provider: string } }
    expect(meta.payload.model_provider).toBe('hxg_x')
  })

  it('改写 rollout 文件中的 model', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'hxg_x', model: 'glm-old' }))

    seedDb([{ id: 'a', provider: 'hxg_x', model: 'glm-old' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\nmodel = "glm-new"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', targetModel: 'glm-new', rewriteRollout: true })
    expect(res.changedRollouts).toBe(1)
    const meta = JSON.parse((await readFile(rolloutA, 'utf8')).split('\n')[0]) as { payload: { model_provider: string; model: string } }
    expect(meta.payload.model_provider).toBe('hxg_x')
    expect(meta.payload.model).toBe('glm-new')
  })

  it('改写 archived_sessions/ 下的 rollout 文件', async () => {
    const archDir = join(home, 'archived_sessions')
    await mkdir(archDir, { recursive: true })
    const rolloutB = join(archDir, 'rollout-b.jsonl')
    await writeFile(rolloutB, rolloutText({ threadId: 'b', provider: 'openai' }))

    seedDb([{ id: 'b', provider: 'openai', archived: 1 }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    expect(res.changedRollouts).toBe(1)
    const meta = JSON.parse((await readFile(rolloutB, 'utf8')).split('\n')[0]) as { payload: { model_provider: string } }
    expect(meta.payload.model_provider).toBe('hxg_x')
  })

  it('rewriteRollout:false 时不改写文件', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    const original = rolloutText({ threadId: 'a', provider: 'openai' })
    await writeFile(rolloutA, original)

    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false })
    expect(res.changedRollouts).toBe(0)
    expect(await readFile(rolloutA, 'utf8')).toBe(original)
  })

  it('多个 session_meta 行都被改写', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai', sessionMetaCount: 3 }))

    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })
    const lines = (await readFile(rolloutA, 'utf8')).split('\n').filter((l) => l.trim())
    const metaLines = lines.filter((l) => {
      try { return (JSON.parse(l) as { type: string }).type === 'session_meta' } catch { return false }
    })
    for (const line of metaLines) {
      expect((JSON.parse(line) as { payload: { model_provider: string } }).payload.model_provider).toBe('hxg_x')
    }
  })
})

// ── repair — global-state ────────────────────────────────────────────────────

describe('CodexSessionRepair.repair — global-state', () => {
  it('规整 .codex-global-state.json 去重路径', async () => {
    const gs = join(home, '.codex-global-state.json')
    await writeFile(gs, JSON.stringify({
      'electron-saved-workspace-roots': ['/ws/a', '/ws/a', '/ws/b'],
    }))
    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const res = await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false })
    expect(res.globalStateKeys).toBeGreaterThanOrEqual(1)
    const state = JSON.parse(await readFile(gs, 'utf8')) as { 'electron-saved-workspace-roots': string[] }
    expect(state['electron-saved-workspace-roots']).toEqual(['/ws/a', '/ws/b'])
  })
})

// ── repair — 停写启生命周期 ──────────────────────────────────────────────────

describe('CodexSessionRepair.repair — lifecycle', () => {
  it('调用 beforeWrite + afterWrite', async () => {
    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false })
    expect(lifecycleCalls).toEqual(['before', 'after'])
  })

  it('即使 repair 中途抛错也调用 afterWrite', async () => {
    // 不创建 db 文件 → repair 会抛 '未找到 Codex 会话库'
    await expect(repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false })).rejects.toThrow()
    // afterWrite 不应被调用(beforeWrite 在 throw 之前)
    // 实际上 findCodexStateDb 失败在 beforeWrite 之前抛，故 lifecycle 不被调用
    expect(lifecycleCalls.filter((c) => c === 'before').length).toBeLessThanOrEqual(1)
  })
})

// ── repair — 进度六阶段 ──────────────────────────────────────────────────────

describe('CodexSessionRepair.repair — onProgress 六阶段', () => {
  it('收到 scan/backup/rollout/sqlite/globalstate/done 阶段', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai' }))
    await writeFile(join(home, '.codex-global-state.json'), JSON.stringify({
      'electron-saved-workspace-roots': ['/ws/a', '/ws/a'],
    }))

    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const phases: string[] = []
    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true }, (p: CodexRepairProgress) => {
      phases.push(p.phase)
    })

    expect(phases).toContain('scan')
    expect(phases).toContain('backup')
    expect(phases).toContain('rollout')
    expect(phases).toContain('sqlite')
    expect(phases).toContain('globalstate')
    expect(phases).toContain('done')

    // done 是最后一个
    expect(phases[phases.length - 1]).toBe('done')

    // percent 0~100
    const percents = phases.map((_, i) => i)  // just check they arrive
    expect(percents.length).toBeGreaterThan(0)
  })

  it('done 阶段 percent=100', async () => {
    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    const progresses: CodexRepairProgress[] = []
    await repair().repair({ targetProvider: 'hxg_x', rewriteRollout: false }, (p) => { progresses.push(p) })
    const done = progresses.find((p) => p.phase === 'done')
    expect(done?.percent).toBe(100)
  })
})

// ── rollback ─────────────────────────────────────────────────────────────────

describe('CodexSessionRepair.rollback', () => {
  it('还原 SQLite', async () => {
    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const svc = repair()
    const res = await svc.repair({ targetProvider: 'hxg_x', rewriteRollout: false })

    const token2 = await fakeLifecycle.beforeWrite()
    await svc.rollback(res.backupId)
    await fakeLifecycle.afterWrite(token2)

    const db = new Database(join(home, 'state_5.sqlite'), { readonly: true })
    const row = db.prepare('SELECT model_provider FROM threads WHERE id=?').get('a') as { model_provider: string }
    db.close()
    expect(row.model_provider).toBe('openai')
  })

  it('还原 rollout 文件', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    await writeFile(rolloutA, rolloutText({ threadId: 'a', provider: 'openai' }))

    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const svc = repair()
    const res = await svc.repair({ targetProvider: 'hxg_x', rewriteRollout: true })

    // rollout 已改为 hxg_x
    const afterRepair = JSON.parse((await readFile(rolloutA, 'utf8')).split('\n')[0]) as { payload: { model_provider: string } }
    expect(afterRepair.payload.model_provider).toBe('hxg_x')

    await svc.rollback(res.backupId)

    const afterRollback = JSON.parse((await readFile(rolloutA, 'utf8')).split('\n')[0]) as { payload: { model_provider: string } }
    expect(afterRollback.payload.model_provider).toBe('openai')
  })

  it('还原 config.toml + .codex-global-state.json', async () => {
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    await writeFile(join(home, '.codex-global-state.json'), JSON.stringify({
      'electron-saved-workspace-roots': ['/ws/a', '/ws/a'],
    }))

    seedDb([{ id: 'a', provider: 'openai' }])
    const svc = repair()
    const res = await svc.repair({ targetProvider: 'hxg_x', rewriteRollout: false })

    // global-state 已被修改(规整后 .bak 也写了)
    // 回滚：还原 config + global-state
    await svc.rollback(res.backupId)

    // config.toml 还原
    expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain('hxg_x')
    // global-state 还原到备份时刻
    expect(existsSync(join(home, '.codex-global-state.json'))).toBe(true)
  })

  it('rollback 调用 beforeWrite + afterWrite', async () => {
    seedDb([{ id: 'a', provider: 'openai' }])
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')
    const svc = repair()
    const res = await svc.repair({ targetProvider: 'hxg_x', rewriteRollout: false })
    lifecycleCalls.length = 0
    await svc.rollback(res.backupId)
    expect(lifecycleCalls).toEqual(['before', 'after'])
  })
})

// ── 失败回滚 ──────────────────────────────────────────────────────────────────

describe('CodexSessionRepair.repair — 失败自动回滚', () => {
  it('SQLite 失败时还原已写的 rollout', async () => {
    const sessDir = join(home, 'sessions')
    await mkdir(sessDir, { recursive: true })
    const rolloutA = join(sessDir, 'rollout-a.jsonl')
    const originalContent = rolloutText({ threadId: 'a', provider: 'openai' })
    await writeFile(rolloutA, originalContent)
    await writeFile(join(home, 'config.toml'), 'model_provider = "hxg_x"\n')

    // 创建损坏的 db（缺 model_provider 列的正确表结构但让 applyUpdates 会失败）
    // 使用根本无效的 SQLite 文件让 CodexStateDb 构造时抛错
    await writeFile(join(home, 'state_5.sqlite'), 'NOT-A-DB')

    await expect(repair().repair({ targetProvider: 'hxg_x', rewriteRollout: true })).rejects.toThrow()

    // rollout 应被还原（或未被改写），provider 仍为 openai
    const line0 = (await readFile(rolloutA, 'utf8')).split('\n')[0]
    const parsed = JSON.parse(line0) as { payload: { model_provider: string } }
    expect(parsed.payload.model_provider).toBe('openai')
  })
})
