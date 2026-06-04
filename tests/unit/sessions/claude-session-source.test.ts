import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSessionSource } from '../../../src/main/contexts/sessions/infrastructure/claude-session-source'

let dir: string
let projects: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hxg-claude-'))
  projects = join(dir, 'projects')
  await mkdir(projects, { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function source() {
  return new ClaudeSessionSource(projects)
}

async function writeSession(proj: string, id: string, lines: object[]) {
  const pdir = join(projects, proj)
  await mkdir(pdir, { recursive: true })
  await writeFile(join(pdir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'))
  return join(pdir, `${id}.jsonl`)
}

describe('ClaudeSessionSource', () => {
  it('scan 解析出 id/cwd/title（首条 user 消息）+ resume 命令', async () => {
    await writeSession('-Users-me-proj', 'sid-1', [
      { type: 'user', sessionId: 'sid-1', cwd: '/Users/me/proj', timestamp: '2026-06-01T00:00:00.000Z', message: { role: 'user', content: 'Hello there' } },
      { type: 'assistant', sessionId: 'sid-1', timestamp: '2026-06-01T00:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] } },
    ])
    const page = await source().scan()
    expect(page.total).toBe(1)
    expect(page.items[0].sessionId).toBe('sid-1')
    expect(page.items[0].projectDir).toBe('/Users/me/proj')
    expect(page.items[0].title).toBe('Hello there')
    expect(page.items[0].resumeCommand).toBe('claude --resume sid-1')
    expect(page.items[0].tool).toBe('claude')
  })

  it('custom-title 优先于首条 user 消息', async () => {
    await writeSession('-p', 'sid-2', [
      { type: 'user', sessionId: 'sid-2', cwd: '/p', timestamp: '2026-06-01T00:00:00.000Z', message: { role: 'user', content: 'first msg' } },
      { type: 'custom-title', sessionId: 'sid-2', customTitle: 'My Title' },
    ])
    const page = await source().scan()
    expect(page.items[0].title).toBe('My Title')
  })

  it('跳过 agent- 前缀文件', async () => {
    const pdir = join(projects, '-p')
    await mkdir(pdir, { recursive: true })
    await writeFile(join(pdir, 'agent-x.jsonl'), JSON.stringify({ sessionId: 'agent-x', message: { role: 'user', content: 'x' } }))
    const page = await source().scan()
    expect(page.total).toBe(0)
  })

  it('readMessages：tool_result 全数组的 user 重分类为 tool', async () => {
    const p = await writeSession('-p', 'sid-3', [
      { type: 'user', sessionId: 'sid-3', cwd: '/p', timestamp: '2026-06-01T00:00:00.000Z', message: { role: 'user', content: 'hi' } },
      { type: 'user', sessionId: 'sid-3', timestamp: '2026-06-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'result text' }] } },
      { isMeta: true, message: { role: 'user', content: 'meta-skip' } },
    ])
    const msgs = await source().readMessages(p)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'tool'])
    expect(msgs[1].content).toBe('result text')
  })

  it('probe：有会话 + lastActiveAt 为最新文件 mtime', async () => {
    await writeSession('-p', 'sid-4', [{ sessionId: 'sid-4', message: { role: 'user', content: 'x' } }])
    const probe = await source().probe()
    expect(probe.tool).toBe('claude')
    expect(probe.hasSessions).toBe(true)
    expect(probe.lastActiveAt).toBeGreaterThan(0)
  })

  it('delete：删主文件 + 同级 sidecar 目录', async () => {
    const p = await writeSession('-p', 'sid-5', [{ sessionId: 'sid-5', message: { role: 'user', content: 'x' } }])
    const sidecar = join(projects, '-p', 'sid-5')
    await mkdir(join(sidecar, 'subagents'), { recursive: true })
    await writeFile(join(sidecar, 'subagents', 'agent-1.jsonl'), '{}')
    await source().delete(p, 'sid-5')
    expect(existsSync(p)).toBe(false)
    expect(existsSync(sidecar)).toBe(false)
  })

  it('空根目录：scan/probe 不报错', async () => {
    await rm(projects, { recursive: true, force: true })
    expect((await source().scan()).total).toBe(0)
    expect((await source().probe()).hasSessions).toBe(false)
  })
})
