import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GeminiSessionSource } from '../../../src/main/contexts/sessions/infrastructure/gemini-session-source'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hxg-gemini-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
function source() {
  return new GeminiSessionSource(dir)
}
async function writeChat(proj: string, file: string, obj: object, projectRoot?: string) {
  const pdir = join(dir, proj)
  await mkdir(join(pdir, 'chats'), { recursive: true })
  if (projectRoot !== undefined) await writeFile(join(pdir, '.project_root'), projectRoot)
  const p = join(pdir, 'chats', file)
  await writeFile(p, JSON.stringify(obj))
  return p
}

describe('GeminiSessionSource', () => {
  it('scan：整份 JSON，projectDir 来自 .project_root，title 取首条 user（含数组 content）', async () => {
    await writeChat(
      'projA',
      'session-2026-05-14T14-50-e86cd6db.json',
      {
        sessionId: 'gem-1',
        startTime: '2026-05-14T14:50:20.770Z',
        lastUpdated: '2026-05-14T15:00:00.000Z',
        messages: [
          { type: 'user', timestamp: '2026-05-14T14:50:20.770Z', content: [{ text: '你是谁' }] },
          { type: 'gemini', timestamp: '2026-05-14T14:50:25.000Z', content: 'I am Gemini.' },
        ],
      },
      '/Users/me/projA',
    )
    const page = await source().scan()
    expect(page.items[0].sessionId).toBe('gem-1')
    expect(page.items[0].projectDir).toBe('/Users/me/projA')
    expect(page.items[0].title).toBe('你是谁')
    expect(page.items[0].lastActiveAt).toBe(Date.parse('2026-05-14T15:00:00.000Z'))
    expect(page.items[0].resumeCommand).toBeUndefined() // gemini 不提供恢复
  })

  it('readMessages：role 映射 + toolCalls 追加 [Tool: name]，info/error 跳过', async () => {
    const p = await writeChat('projB', 'session-x.json', {
      sessionId: 'gem-2',
      startTime: '2026-05-14T00:00:00.000Z',
      lastUpdated: '2026-05-14T00:01:00.000Z',
      messages: [
        { type: 'user', timestamp: '2026-05-14T00:00:00.000Z', content: [{ text: 'hi' }] },
        { type: 'gemini', timestamp: '2026-05-14T00:00:05.000Z', content: 'calling tool', toolCalls: [{ name: 'activate_skill' }] },
        { type: 'info', timestamp: '2026-05-14T00:00:06.000Z', content: 'noise' },
      ],
    })
    const msgs = await source().readMessages(p)
    expect(msgs).toEqual([
      { role: 'user', content: 'hi', ts: Date.parse('2026-05-14T00:00:00.000Z') },
      { role: 'assistant', content: 'calling tool\n[Tool: activate_skill]', ts: Date.parse('2026-05-14T00:00:05.000Z') },
    ])
  })

  it('probe + delete', async () => {
    const p = await writeChat('projC', 'session-y.json', { sessionId: 'gem-3', startTime: '2026-05-14T00:00:00.000Z', messages: [] }, '/c')
    const probe = await source().probe()
    expect(probe.hasSessions).toBe(true)
    await source().delete(p, 'gem-3')
    expect(existsSync(p)).toBe(false)
  })

  it('缺 sessionId 的文件被跳过；空 tmp 不报错', async () => {
    await writeChat('projD', 'session-z.json', { startTime: '2026-05-14T00:00:00.000Z', messages: [] }, '/d')
    expect((await source().scan()).items.length).toBe(0)
    await rm(dir, { recursive: true, force: true })
    expect((await source().probe()).hasSessions).toBe(false)
  })
})
