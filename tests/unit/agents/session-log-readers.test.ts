import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClaudeSessionLogReader,
  CodexSessionLogReader,
  GeminiCliSessionLogReader,
  KiroSessionLogReader,
  QoderSessionLogReader,
} from '../../../src/main/agents/infrastructure/shared/session-log-readers'
import { appSupportDir, dotDir } from '../../../src/main/agents/infrastructure/shared/path-resolver'

// Sandbox the home dir so readers resolve to temp paths. dotDir/appSupportDir
// both derive from os.homedir(), which honors $HOME (and XDG on Linux).
let home: string
let savedHome: string | undefined
let savedXdgConfig: string | undefined
let savedXdgData: string | undefined
let savedAppData: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agents-logs-home-'))
  savedHome = process.env.HOME
  savedXdgConfig = process.env.XDG_CONFIG_HOME
  savedXdgData = process.env.XDG_DATA_HOME
  savedAppData = process.env.APPDATA
  process.env.HOME = home
  // Keep Linux/Windows path resolution inside the sandbox too.
  process.env.XDG_CONFIG_HOME = join(home, '.config')
  process.env.XDG_DATA_HOME = join(home, '.local', 'share')
  process.env.APPDATA = join(home, 'AppData', 'Roaming')
})
afterEach(() => {
  process.env.HOME = savedHome
  process.env.XDG_CONFIG_HOME = savedXdgConfig
  process.env.XDG_DATA_HOME = savedXdgData
  process.env.APPDATA = savedAppData
  rmSync(home, { recursive: true, force: true })
})

function writeFileEnsuring(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

describe('ClaudeSessionLogReader', () => {
  it('parses ~/.claude/projects/**/*.jsonl, skipping lines without usage tokens', async () => {
    const reader = new ClaudeSessionLogReader()
    const file = join(dotDir('claude'), 'projects', 'proj', 'a.jsonl')
    const lines = [
      JSON.stringify({ type: 'system' }), // no usage → skipped
      JSON.stringify({
        timestamp: '2024-01-01T00:00:00Z',
        sessionId: 's1',
        message: {
          model: 'claude-3',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
        },
      }),
    ]
    writeFileEnsuring(file, lines.join('\n'))

    const batch = await reader.readUsageMetrics(null)
    expect(batch.records.length).toBe(1)
    const r = batch.records[0]
    expect(r.agentId).toBe('claude')
    expect(r.providerName).toBe('anthropic')
    expect(r.model).toBe('claude-3')
    expect(r.sessionId).toBe('s1')
    expect([r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheCreationTokens]).toEqual([10, 5, 2, 1])
    expect(r.occurredAt).toBe(Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000))
  })
})

describe('CodexSessionLogReader (cumulative delta)', () => {
  it('subtracts the previous line totals; skips zero-delta lines', async () => {
    const reader = new CodexSessionLogReader()
    const file = join(dotDir('codex'), 'sessions', 's.jsonl')
    const mk = (i: number, o: number) =>
      JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', response: { model: 'gpt', usage: { input_tokens: i, output_tokens: o } } })
    // running totals: (100,50) then (150,80) then (150,80 no change)
    writeFileEnsuring(file, [mk(100, 50), mk(150, 80), mk(150, 80)].join('\n'))

    const batch = await reader.readUsageMetrics(null)
    // first line delta = 100/50; second = 50/30; third = 0/0 (skipped)
    expect(batch.records.length).toBe(2)
    expect([batch.records[0].inputTokens, batch.records[0].outputTokens]).toEqual([100, 50])
    expect([batch.records[1].inputTokens, batch.records[1].outputTokens]).toEqual([50, 30])
    expect(batch.records[0].providerName).toBe('openai')
  })

  it('clamps negative deltas to zero when the counter resets', async () => {
    const reader = new CodexSessionLogReader()
    const file = join(dotDir('codex'), 'sessions', 'reset.jsonl')
    const mk = (i: number, o: number) =>
      JSON.stringify({ response: { usage: { input_tokens: i, output_tokens: o } } })
    // 100/50 then reset to 10/5 → deltas clamp to 0/0 and that line is skipped
    writeFileEnsuring(file, [mk(100, 50), mk(10, 5)].join('\n'))
    const batch = await reader.readUsageMetrics(null)
    expect(batch.records.length).toBe(1)
    expect([batch.records[0].inputTokens, batch.records[0].outputTokens]).toEqual([100, 50])
  })
})

describe('GeminiCliSessionLogReader (events array, output+thoughts)', () => {
  it('sums output + thoughts and reads input/cached', async () => {
    const reader = new GeminiCliSessionLogReader()
    const file = join(dotDir('gemini'), 'tmp', 'session-abc.json')
    writeFileEnsuring(
      file,
      JSON.stringify({
        events: [
          {
            timestamp: '2024-02-02T00:00:00Z',
            sessionId: 'g1',
            model: 'gemini-pro',
            tokens: { input: 20, output: 7, thoughts: 3, cached: 4 },
          },
        ],
      }),
    )
    const batch = await reader.readUsageMetrics(null)
    expect(batch.records.length).toBe(1)
    const r = batch.records[0]
    expect(r.agentId).toBe('gemini_cli')
    expect(r.providerName).toBe('google')
    expect(r.inputTokens).toBe(20)
    expect(r.outputTokens).toBe(10) // 7 + 3
    expect(r.cacheReadTokens).toBe(4)
  })
})

describe('KiroSessionLogReader (promptTokens/generatedTokens)', () => {
  it('reads the single tokens_generated.jsonl with kiro field names', async () => {
    const reader = new KiroSessionLogReader()
    const file = join(
      appSupportDir('Kiro'),
      'User',
      'globalStorage',
      'kiro.kiroagent',
      'dev_data',
      'tokens_generated.jsonl',
    )
    writeFileEnsuring(
      file,
      JSON.stringify({ timestamp: '2024-03-03T00:00:00Z', sessionId: 'k1', model: 'kiro-m', promptTokens: 12, generatedTokens: 8 }),
    )
    const batch = await reader.readUsageMetrics(null)
    expect(batch.records.length).toBe(1)
    const r = batch.records[0]
    expect(r.agentId).toBe('kiro')
    expect(r.inputTokens).toBe(12)
    expect(r.outputTokens).toBe(8)
    expect(r.sourceEventId).toBe('kiro-0')
  })

  it('returns empty batch when the log file is absent', async () => {
    const reader = new KiroSessionLogReader()
    const batch = await reader.readUsageMetrics(null)
    expect(batch.records).toEqual([])
  })
})

describe('QoderSessionLogReader (glob + prompt/completion tokens)', () => {
  it('reads task-*.session.execution-session.json files', async () => {
    const reader = new QoderSessionLogReader()
    const file = join(
      appSupportDir('Qoder'),
      'SharedClientCache',
      'cli',
      'projects',
      'p1',
      'task-1.session.execution-session.json',
    )
    writeFileEnsuring(
      file,
      JSON.stringify({ id: 'evt-1', session_id: 'q1', model: 'qoder-m', prompt_tokens: 30, completion_tokens: 9, timestamp: '2024-04-04T00:00:00Z' }),
    )
    // a non-matching file in the same tree must be ignored
    writeFileEnsuring(join(appSupportDir('Qoder'), 'SharedClientCache', 'cli', 'projects', 'p1', 'other.json'), '{}')

    const batch = await reader.readUsageMetrics(null)
    expect(batch.records.length).toBe(1)
    const r = batch.records[0]
    expect(r.agentId).toBe('qoder')
    expect(r.sourceEventId).toBe('evt-1')
    expect(r.inputTokens).toBe(30)
    expect(r.outputTokens).toBe(9)
  })
})
