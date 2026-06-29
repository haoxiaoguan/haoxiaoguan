import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeDesktopSessionSource } from '../../../src/main/contexts/sessions/infrastructure/claude-desktop-session-source'

let root: string
let appSupport: string
let projects: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-claude-desktop-source-'))
  appSupport = join(root, 'Claude')
  projects = join(root, 'projects')
  await mkdir(appSupport, { recursive: true })
  await mkdir(projects, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeTranscript(project: string, id: string, lines: object[]): Promise<string> {
  const dir = join(projects, project)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.jsonl`)
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n'))
  return file
}

async function writeDesktopIndex(nsA: string, nsB: string, name: string, body: Record<string, unknown>): Promise<void> {
  const dir = join(appSupport, 'claude-code-sessions', nsA, nsB)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `local_${name}.json`), JSON.stringify(body, null, 2))
}

describe('ClaudeDesktopSessionSource', () => {
  it('只列出 Claude Desktop local 索引能关联到的会话，不混入 CLI-only transcript', async () => {
    const desktopFile = await writeTranscript('-work', 'sid-desktop', [
      {
        type: 'user',
        sessionId: 'sid-desktop',
        cwd: '/work',
        timestamp: '2026-06-01T00:00:00.000Z',
        message: { role: 'user', content: 'desktop hello' },
      },
      {
        type: 'assistant',
        sessionId: 'sid-desktop',
        timestamp: '2026-06-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'desktop answer' },
      },
    ])
    await writeTranscript('-work', 'sid-cli-only', [
      {
        type: 'user',
        sessionId: 'sid-cli-only',
        cwd: '/work',
        timestamp: '2026-06-01T00:00:00.000Z',
        message: { role: 'user', content: 'cli only' },
      },
    ])
    await writeDesktopIndex('space-a', 'space-b', 'desktop', {
      sessionId: 'desktop-local-id',
      cliSessionId: 'sid-desktop',
      cwd: '/work',
      title: 'Desktop title',
      lastActivityAt: '2026-06-01T00:00:03.000Z',
    })

    const source = new ClaudeDesktopSessionSource(appSupport, projects)
    const page = await source.scan()

    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      tool: 'claude_desktop',
      sessionId: 'sid-desktop',
      title: 'Desktop title',
      projectDir: '/work',
      sourcePath: desktopFile,
      resumeCommand: 'claude --resume sid-desktop',
    })
  })

  it('readMessages 复用 Claude transcript 解析', async () => {
    const file = await writeTranscript('-work', 'sid-desktop', [
      {
        type: 'user',
        sessionId: 'sid-desktop',
        cwd: '/work',
        timestamp: '2026-06-01T00:00:00.000Z',
        message: { role: 'user', content: 'hello from desktop' },
      },
    ])
    await writeDesktopIndex('space-a', 'space-b', 'desktop', {
      cliSessionId: 'sid-desktop',
      lastActivityAt: '2026-06-01T00:00:01.000Z',
    })

    const source = new ClaudeDesktopSessionSource(appSupport, projects)
    const messages = await source.readMessages(file)

    expect(messages.map((m) => m.content)).toEqual(['hello from desktop'])
  })
})
