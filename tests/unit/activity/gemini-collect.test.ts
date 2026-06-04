import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GeminiSessionSource } from '../../../src/main/contexts/sessions/infrastructure/gemini-session-source'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-act-gemini-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function writeChat(proj: string, file: string, obj: object) {
  const pdir = join(dir, proj, 'chats')
  await mkdir(pdir, { recursive: true })
  const p = join(pdir, file)
  await writeFile(p, JSON.stringify(obj))
  return p
}

describe('GeminiSessionSource.collectLogEvents', () => {
  it('session 事件取 startTime；toolCalls best-effort 计 tool_call', async () => {
    await writeChat('projA', 'session-1.json', {
      sessionId: 'g1', startTime: '2023-11-14T00:00:00.000Z', lastUpdated: '2023-11-14T00:10:00.000Z',
      messages: [
        { id: 'm0', type: 'user', timestamp: '2023-11-14T00:00:00.000Z', content: 'hi' },
        { id: 'm1', type: 'gemini', timestamp: '2023-11-14T00:00:05.000Z', content: 'ok', toolCalls: [{ name: 'run_shell' }] },
      ],
    })
    const { events } = await new GeminiSessionSource(dir).collectLogEvents()
    expect(events.filter((e) => e.kind === 'session')).toHaveLength(1)
    expect(events.find((e) => e.kind === 'session')!.ts).toBe(Date.parse('2023-11-14T00:00:00.000Z'))
    const calls = events.filter((e) => e.kind === 'tool_call')
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('run_shell')
  })

  it('无 toolCalls 的纯文本会话只产出 session 事件', async () => {
    await writeChat('projB', 'session-2.json', {
      sessionId: 'g2', startTime: '2023-11-14T00:00:00.000Z',
      messages: [{ id: 'm0', type: 'user', timestamp: '2023-11-14T00:00:00.000Z', content: 'hi' }],
    })
    const { events } = await new GeminiSessionSource(dir).collectLogEvents()
    expect(events.filter((e) => e.kind === 'tool_call')).toHaveLength(0)
    expect(events.filter((e) => e.kind === 'session')).toHaveLength(1)
  })
})
