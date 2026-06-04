import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexSessionSource } from '../../../src/main/contexts/sessions/infrastructure/codex-session-source'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-act-codex-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function writeSession(name: string, lines: object[]) {
  const sdir = join(dir, 'sessions')
  await mkdir(sdir, { recursive: true })
  const p = join(sdir, name)
  await writeFile(p, lines.map((l) => JSON.stringify(l)).join('\n'))
  return p
}

describe('CodexSessionSource.collectLogEvents', () => {
  it('session 事件取首条时间戳；function_call / custom_tool_call 各计一次 tool_call', async () => {
    await writeSession('rollout-1.jsonl', [
      { type: 'session_meta', timestamp: '2023-11-14T00:00:00.000Z', payload: { id: 'c1', cwd: '/p' } },
      { type: 'response_item', timestamp: '2023-11-14T00:00:03.000Z', payload: { type: 'function_call', call_id: 'call-a', name: 'shell' } },
      { type: 'response_item', timestamp: '2023-11-14T00:00:06.000Z', payload: { type: 'custom_tool_call', call_id: 'call-b', name: 'apply_patch' } },
    ])
    const { events } = await new CodexSessionSource(dir).collectLogEvents()
    expect(events.filter((e) => e.kind === 'session')).toHaveLength(1)
    expect(events.find((e) => e.kind === 'session')!.ts).toBe(Date.parse('2023-11-14T00:00:00.000Z'))
    const calls = events.filter((e) => e.kind === 'tool_call')
    expect(calls.map((c) => c.sourceKey).sort()).toEqual(['call-a', 'call-b'])
    expect(calls.map((c) => c.name).sort()).toEqual(['apply_patch', 'shell'])
  })

  it('apply_patch custom_tool_call 产出 code_edit 事件并携带 amount', async () => {
    const PATCH = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      ' keep',
      '-old',
      '+n1',
      '+n2',
      '*** End Patch',
    ].join('\n')
    await writeSession('rollout-3.jsonl', [
      { type: 'session_meta', timestamp: '2023-11-14T00:00:00.000Z', payload: { id: 'c3', cwd: '/p' } },
      { type: 'response_item', timestamp: '2023-11-14T00:00:03.000Z', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'apply_patch', input: PATCH } },
    ])
    const { events } = await new CodexSessionSource(dir).collectLogEvents()
    const edits = events.filter((e) => e.kind === 'code_edit')
    expect(edits).toHaveLength(1)
    expect(edits[0].amount).toBe(3)
    expect(edits[0].sourceKey).toBe('c1')
  })

  it('subagent 会话整体跳过', async () => {
    await writeSession('rollout-2.jsonl', [
      { type: 'session_meta', timestamp: '2023-11-14T00:00:00.000Z', payload: { id: 'c2', source: { subagent: true } } },
      { type: 'response_item', timestamp: '2023-11-14T00:00:03.000Z', payload: { type: 'function_call', call_id: 'x', name: 'shell' } },
    ])
    const { events } = await new CodexSessionSource(dir).collectLogEvents()
    expect(events).toHaveLength(0)
  })
})
