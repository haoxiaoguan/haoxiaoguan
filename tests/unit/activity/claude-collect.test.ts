import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSessionSource } from '../../../src/main/contexts/sessions/infrastructure/claude-session-source'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-act-claude-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function writeSession(proj: string, id: string, lines: object[]) {
  const pdir = join(dir, proj)
  await mkdir(pdir, { recursive: true })
  const p = join(pdir, `${id}.jsonl`)
  await writeFile(p, lines.map((l) => JSON.stringify(l)).join('\n'))
  return p
}

describe('ClaudeSessionSource.collectLogEvents', () => {
  it('产出 1 个 session 事件 + 每个 tool_use 一个 tool_call 事件', async () => {
    await writeSession('-p', 'sid-1', [
      { type: 'user', uuid: 'u0', timestamp: '2023-11-14T00:00:00.000Z', message: { role: 'user', content: 'hi' } },
      {
        type: 'assistant', uuid: 'u1', timestamp: '2023-11-14T00:00:05.000Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'Bash' }] },
      },
    ])
    const { events, latestMtime } = await new ClaudeSessionSource(dir).collectLogEvents()
    const sessions = events.filter((e) => e.kind === 'session')
    const calls = events.filter((e) => e.kind === 'tool_call')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].ts).toBe(Date.parse('2023-11-14T00:00:00.000Z'))
    expect(calls.map((c) => c.name)).toEqual(['Edit', 'Bash'])
    expect(new Set(calls.map((c) => c.sourceKey)).size).toBe(2) // 同行两个 tool_use 键不同
    expect(latestMtime).toBeGreaterThan(0)
  })

  it('since 大于文件 mtime 时跳过该文件', async () => {
    const p = await writeSession('-p', 'sid-2', [
      { type: 'user', uuid: 'u', timestamp: '2023-11-14T00:00:00.000Z', message: { role: 'user', content: 'x' } },
    ])
    const { stat } = await import('node:fs/promises')
    const m = (await stat(p)).mtimeMs
    const { events } = await new ClaudeSessionSource(dir).collectLogEvents({ since: m + 1000 })
    expect(events).toHaveLength(0)
  })

  it('agent- 前缀文件被排除', async () => {
    await mkdir(join(dir, '-p'), { recursive: true })
    await writeFile(join(dir, '-p', 'agent-x.jsonl'), JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2023-11-14T00:00:00.000Z', message: { role: 'user', content: 'x' } }))
    const { events } = await new ClaudeSessionSource(dir).collectLogEvents()
    expect(events).toHaveLength(0)
  })
})
