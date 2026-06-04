import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexSessionSource } from '../../../src/main/contexts/sessions/infrastructure/codex-session-source'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hxg-codex-'))
  await mkdir(join(dir, 'sessions', '2026', '06', '01'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
function source() {
  return new CodexSessionSource(dir)
}
async function writeRollout(name: string, lines: object[]) {
  const p = join(dir, 'sessions', '2026', '06', '01', name)
  await writeFile(p, lines.map((l) => JSON.stringify(l)).join('\n'))
  return p
}

describe('CodexSessionSource', () => {
  it('scan：解析 session_meta + 首条 user 消息为标题', async () => {
    await writeRollout('rollout-1-019e9178-9e3c-7183-aea6-3a28db08c7b0.jsonl', [
      { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: '019e9178-9e3c-7183-aea6-3a28db08c7b0', cwd: '/work/proj' } },
      { timestamp: '2026-06-01T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Real question' }] } },
    ])
    const page = await source().scan()
    expect(page.items[0].sessionId).toBe('019e9178-9e3c-7183-aea6-3a28db08c7b0')
    expect(page.items[0].projectDir).toBe('/work/proj')
    expect(page.items[0].title).toBe('Real question')
    expect(page.items[0].resumeCommand).toBe('codex resume 019e9178-9e3c-7183-aea6-3a28db08c7b0')
  })

  it('首条 user 跳过 # AGENTS.md / <environment_context>，标题回退目录名', async () => {
    await writeRollout('rollout-2-aaaaaaaa-0000-0000-0000-000000000000.jsonl', [
      { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'aaaaaaaa-0000-0000-0000-000000000000', cwd: '/work/myrepo' } },
      { timestamp: '2026-06-01T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions' }] } },
    ])
    const page = await source().scan()
    expect(page.items[0].title).toBe('myrepo')
  })

  it('默认跳过 subagent 会话', async () => {
    await writeRollout('rollout-3-bbbbbbbb-0000-0000-0000-000000000000.jsonl', [
      { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'bbbbbbbb-0000-0000-0000-000000000000', cwd: '/x', source: { subagent: {} } } },
    ])
    const page = await source().scan()
    expect(page.total).toBe(1) // 文件被扫到
    expect(page.items.length).toBe(0) // 但解析跳过
  })

  it('readMessages：message / function_call / function_call_output 三类', async () => {
    const p = await writeRollout('rollout-4-cccccccc-0000-0000-0000-000000000000.jsonl', [
      { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'cccccccc-0000-0000-0000-000000000000', cwd: '/x' } },
      { timestamp: '2026-06-01T00:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
      { timestamp: '2026-06-01T00:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell' } },
      { timestamp: '2026-06-01T00:00:03.000Z', type: 'response_item', payload: { type: 'function_call_output', output: 'done' } },
    ])
    const msgs = await source().readMessages(p)
    expect(msgs).toEqual([
      { role: 'user', content: 'hi', ts: Date.parse('2026-06-01T00:00:01.000Z') },
      { role: 'assistant', content: '[Tool: shell]', ts: Date.parse('2026-06-01T00:00:02.000Z') },
      { role: 'tool', content: 'done', ts: Date.parse('2026-06-01T00:00:03.000Z') },
    ])
  })

  it('function_call_output 非字符串 output → JSON 字符串而非 [object Object]；null → 跳过', async () => {
    const p = await writeRollout('rollout-7-eeeeeeee-0000-0000-0000-000000000000.jsonl', [
      { timestamp: '2026-06-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'eeeeeeee-0000-0000-0000-000000000000', cwd: '/x' } },
      { timestamp: '2026-06-01T00:00:01.000Z', type: 'response_item', payload: { type: 'function_call_output', output: { ok: true } } },
      { timestamp: '2026-06-01T00:00:02.000Z', type: 'response_item', payload: { type: 'function_call_output', output: null } },
    ])
    const msgs = await source().readMessages(p)
    expect(msgs).toEqual([{ role: 'tool', content: '{"ok":true}', ts: Date.parse('2026-06-01T00:00:01.000Z') }])
  })

  it('archived_sessions 也被扫描；delete 删文件无 sidecar', async () => {
    await mkdir(join(dir, 'archived_sessions'), { recursive: true })
    const a = join(dir, 'archived_sessions', 'rollout-9-dddddddd-0000-0000-0000-000000000000.jsonl')
    await writeFile(a, JSON.stringify({ timestamp: '2026-06-02T00:00:00.000Z', type: 'session_meta', payload: { id: 'dddddddd-0000-0000-0000-000000000000', cwd: '/y' } }))
    const page = await source().scan()
    expect(page.items.some((s) => s.sessionId === 'dddddddd-0000-0000-0000-000000000000')).toBe(true)
    await source().delete(a, 'dddddddd-0000-0000-0000-000000000000')
    expect(existsSync(a)).toBe(false)
  })
})
