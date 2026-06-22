import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeAgentClient } from '../../../src/main/agents/claude/claude-agent'

// 沙箱化 $HOME，使 dotDir('claude') 解析到临时目录（dotDir 走 os.homedir()）。
let home: string
let savedHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-home-'))
  savedHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  process.env.HOME = savedHome
  rmSync(home, { recursive: true, force: true })
})

const projects = (): string => join(home, '.claude', 'projects')

function write(path: string, lines: object[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'))
}

function assistant(
  id: string,
  usage: Record<string, number>,
  stop: string | null,
): object {
  return {
    type: 'assistant',
    timestamp: '2026-05-10T00:00:00Z',
    sessionId: 's1',
    message: { id, model: 'claude-opus-4-8', stop_reason: stop, usage },
  }
}

async function run(): Promise<Awaited<ReturnType<NonNullable<ReturnType<ClaudeAgentClient['asSessionLogReader']>>['readUsageMetrics']>>> {
  const reader = new ClaudeAgentClient().asSessionLogReader()
  if (!reader) throw new Error('no reader')
  return reader.readUsageMetrics(null)
}

describe('ClaudeAgentClient usage reader — message.id 去重（对齐 cc-switch 口径）', () => {
  it('同一 message.id 的多条相同行只计一次', async () => {
    const u = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 10 }
    write(join(projects(), 'proj', 'a.jsonl'), [
      assistant('msg_A', u, 'end_turn'),
      assistant('msg_A', u, 'end_turn'),
      assistant('msg_A', u, 'end_turn'),
    ])
    const batch = await run()
    expect(batch.records.length).toBe(1)
    const r = batch.records[0]
    expect(r.sourceEventId).toBe('msg_A')
    expect([r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheCreationTokens]).toEqual([100, 20, 5000, 10])
  })

  it('同 message.id 取有 stop_reason 的最终帧（丢弃中间无 stop_reason 帧）', async () => {
    write(join(projects(), 'proj', 'b.jsonl'), [
      assistant('msg_B', { input_tokens: 1, output_tokens: 5 }, null),
      assistant('msg_B', { input_tokens: 1, output_tokens: 26 }, 'tool_use'),
    ])
    const batch = await run()
    expect(batch.records.length).toBe(1)
    expect(batch.records[0].outputTokens).toBe(26)
  })

  it('output_tokens=0 但有 input/cache_read 计费的条目仍计入（对齐 cc-switch）', async () => {
    write(join(projects(), 'proj', 'c.jsonl'), [
      assistant('msg_C', { input_tokens: 999, output_tokens: 0, cache_read_input_tokens: 999 }, 'end_turn'),
    ])
    const batch = await run()
    expect(batch.records.length).toBe(1)
    expect(batch.records[0].inputTokens).toBe(999)
    expect(batch.records[0].cacheReadTokens).toBe(999)
  })

  it('无 stop_reason 但有计费 token 的 message.id 计入（workflow/subagent 场景，对齐 cc-switch）', async () => {
    write(join(projects(), 'proj', 'd.jsonl'), [
      assistant('msg_D', { input_tokens: 1, output_tokens: 5 }, null),
    ])
    const batch = await run()
    expect(batch.records.length).toBe(1)
    expect(batch.records[0].inputTokens).toBe(1)
    expect(batch.records[0].outputTokens).toBe(5)
  })

  it('subagent 文件里的独立 message.id 计入（真实子调用），且各自去重', async () => {
    const u = { input_tokens: 10, output_tokens: 7 }
    write(join(projects(), 'proj', 'main.jsonl'), [assistant('msg_main', u, 'end_turn')])
    write(join(projects(), 'proj', 'sess', 'subagents', 'agent-x.jsonl'), [
      assistant('msg_sub', u, 'end_turn'),
      assistant('msg_sub', u, 'end_turn'),
    ])
    const batch = await run()
    expect(batch.records.map((r) => r.sourceEventId).sort()).toEqual(['msg_main', 'msg_sub'])
  })

  it('非 assistant 行被忽略', async () => {
    write(join(projects(), 'proj', 'e.jsonl'), [
      { type: 'user', message: { id: 'x', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ])
    const batch = await run()
    expect(batch.records.length).toBe(0)
  })

  it('损坏文件被跳过而不影响其他文件（健壮性）', async () => {
    write(join(projects(), 'proj', 'good.jsonl'), [assistant('msg_ok', { input_tokens: 1, output_tokens: 2 }, 'end_turn')])
    mkdirSync(join(projects(), 'proj2'), { recursive: true })
    // 一行无法 JSON.parse —— 该行被跳过，文件其余照常
    writeFileSync(join(projects(), 'proj2', 'bad.jsonl'), '{not json\n' + JSON.stringify(assistant('msg_ok2', { input_tokens: 1, output_tokens: 3 }, 'end_turn')))
    const batch = await run()
    expect(batch.records.map((r) => r.sourceEventId).sort()).toEqual(['msg_ok', 'msg_ok2'])
  })
})
