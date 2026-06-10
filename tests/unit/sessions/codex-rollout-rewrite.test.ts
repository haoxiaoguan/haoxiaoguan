import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rewriteRolloutProvider } from '../../../src/main/contexts/sessions/infrastructure/codex-rollout-rewrite'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-rollout-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('rewriteRolloutProvider', () => {
  it('只改首行 session_meta.payload.model_provider,保留其余行/字段', async () => {
    const p = join(dir, 'r.jsonl')
    const line1 = { type: 'session_meta', payload: { id: 'x', cwd: '/w', model_provider: 'openai', model: 'gpt-5.5' } }
    const line2 = { type: 'response_item', payload: { type: 'message', role: 'user', content: 'hi' } }
    await writeFile(p, [JSON.stringify(line1), JSON.stringify(line2)].join('\n'))
    const r = await rewriteRolloutProvider(p, 'hxg_x')
    expect(r).toEqual({ ok: true, oldProvider: 'openai' })
    const out = (await readFile(p, 'utf8')).split('\n')
    expect(JSON.parse(out[0]).payload.model_provider).toBe('hxg_x')
    expect(JSON.parse(out[0]).payload.model).toBe('gpt-5.5') // 其它字段不动
    expect(out[1]).toBe(JSON.stringify(line2)) // 后续行原样
  })

  it('已是目标 provider → ok:true 但 oldProvider 等于目标(幂等)', async () => {
    const p = join(dir, 'r2.jsonl')
    await writeFile(p, JSON.stringify({ type: 'session_meta', payload: { id: 'x', model_provider: 'hxg_x' } }))
    const r = await rewriteRolloutProvider(p, 'hxg_x')
    expect(r).toEqual({ ok: true, oldProvider: 'hxg_x' })
  })

  it('首行非 session_meta / 文件缺失 → ok:false', async () => {
    const bad = join(dir, 'bad.jsonl')
    await writeFile(bad, JSON.stringify({ type: 'response_item', payload: {} }))
    expect((await rewriteRolloutProvider(bad, 'hxg_x')).ok).toBe(false)
    expect((await rewriteRolloutProvider(join(dir, 'nope.jsonl'), 'hxg_x')).ok).toBe(false)
  })
})
