import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    readFile: vi.fn(async () => {
      throw new Error('readFile should not be used for JSONL session reads')
    }),
  }
})

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('JSONL session sources stream file reads', () => {
  it('Codex readMessages and collectLogEvents do not require readFile', async () => {
    const root = tempDir('hxg-codex-stream-')
    const sessionsDir = join(root, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const file = join(sessionsDir, 'rollout-aaaaaaaa-0000-0000-0000-000000000000.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({
          timestamp: '2026-06-01T00:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'aaaaaaaa-0000-0000-0000-000000000000', cwd: '/work' },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T00:00:01.000Z',
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T00:00:02.000Z',
          type: 'response_item',
          payload: { type: 'function_call', call_id: 'call-1', name: 'shell' },
        }),
      ].join('\n'),
    )

    const { CodexSessionSource } = await import(
      '../../../src/main/contexts/sessions/infrastructure/codex-session-source'
    )
    const source = new CodexSessionSource(root)

    const messages = await source.readMessages(file)
    expect(messages.map((message) => message.content)).toEqual(['hello', '[Tool: shell]'])

    const { events } = await source.collectLogEvents()
    expect(events.map((event) => event.kind).sort()).toEqual(['session', 'tool_call'])
  })

  it('Claude readMessages and collectLogEvents do not require readFile', async () => {
    const root = tempDir('hxg-claude-stream-')
    const projectDir = join(root, 'projects', '-work')
    mkdirSync(projectDir, { recursive: true })
    const file = join(projectDir, 'sid-1.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: 'user',
          sessionId: 'sid-1',
          cwd: '/work',
          timestamp: '2026-06-01T00:00:00.000Z',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: 'sid-1',
          timestamp: '2026-06-01T00:00:01.000Z',
          uuid: 'assistant-1',
          message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] },
        }),
      ].join('\n'),
    )

    const { ClaudeSessionSource } = await import(
      '../../../src/main/contexts/sessions/infrastructure/claude-session-source'
    )
    const source = new ClaudeSessionSource(join(root, 'projects'))

    const messages = await source.readMessages(file)
    expect(messages.map((message) => message.content)).toEqual(['hello', '[Tool: Edit]'])

    const { events } = await source.collectLogEvents()
    expect(events.map((event) => event.kind).sort()).toEqual(['session', 'tool_call'])
  })
})
