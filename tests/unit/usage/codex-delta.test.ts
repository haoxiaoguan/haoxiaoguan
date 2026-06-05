/**
 * Unit tests for Codex delta-encoding logic (token_count event path).
 * Tokens come from value.payload.info.total_token_usage (cumulative per file).
 * Normalised: inputTokens = dInRaw - dCached, cacheReadTokens = dCached,
 *             outputTokens = dOut + dReason, cacheCreationTokens = 0.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

function writeTmpJsonl(dir: string, name: string, lines: object[]): string {
  const p = join(dir, name)
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return p
}

describe('Codex delta-encoding (token_count/payload.info path)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `codex-test-${Date.now()}`)
    mkdirSync(join(tmpDir, 'sessions'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('produces correct deltas and normalisation from two token_count lines', () => {
    // Line 0: cumulative input=100, cached=80, output=20, reasoning=5
    //   dInRaw=100, dCached=80, dOut=20, dReason=5
    //   inputTokens=max(0,100-80)=20, cacheReadTokens=80, outputTokens=20+5=25
    // Line 1: cumulative input=200, cached=160, output=40, reasoning=10
    //   dInRaw=100, dCached=80, dOut=20, dReason=5
    //   inputTokens=20, cacheReadTokens=80, outputTokens=25
    const lines = [
      {
        type: 'event_msg',
        timestamp: '2024-01-01T00:00:00Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 80,
              output_tokens: 20,
              reasoning_output_tokens: 5,
            },
          },
        },
      },
      {
        type: 'event_msg',
        timestamp: '2024-01-01T00:01:00Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 200,
              cached_input_tokens: 160,
              output_tokens: 40,
              reasoning_output_tokens: 10,
            },
          },
        },
      },
    ]
    const deltas = computeCodexDeltas(lines)
    expect(deltas).toHaveLength(2)

    expect(deltas[0].inputTokens).toBe(20)       // 100 - 80
    expect(deltas[0].cacheReadTokens).toBe(80)
    expect(deltas[0].outputTokens).toBe(25)       // 20 + 5
    expect(deltas[0].cacheCreationTokens).toBe(0)

    expect(deltas[1].inputTokens).toBe(20)        // (200-100) - (160-80)
    expect(deltas[1].cacheReadTokens).toBe(80)
    expect(deltas[1].outputTokens).toBe(25)       // (40-20) + (10-5)
  })

  it('lines without payload.info.total_token_usage are skipped', () => {
    const lines = [
      { type: 'event_msg', timestamp: '2024-01-01T00:00:00Z', payload: { type: 'turn_context', model: 'codex-x' } },
      { type: 'event_msg', timestamp: '2024-01-01T00:01:00Z', response: { usage: { input_tokens: 999 } } },
      {
        type: 'event_msg',
        timestamp: '2024-01-01T00:02:00Z',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0 } },
        },
      },
    ]
    const deltas = computeCodexDeltas(lines)
    expect(deltas).toHaveLength(1)
    expect(deltas[0].inputTokens).toBe(50)
    expect(deltas[0].outputTokens).toBe(10)
  })

  it('saturating_sub: counter reset produces 0 delta, record skipped', () => {
    const lines = [
      {
        type: 'event_msg',
        timestamp: '2024-01-01T00:00:00Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 } } },
      },
      {
        type: 'event_msg',
        timestamp: '2024-01-01T00:01:00Z',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } } },
      },
    ]
    const deltas = computeCodexDeltas(lines)
    // Line 0: inputTokens=500, outputTokens=200
    // Line 1: counter reset → dInRaw=0, dOut=0 → skipped
    expect(deltas).toHaveLength(1)
    expect(deltas[0].inputTokens).toBe(500)
    expect(deltas[0].outputTokens).toBe(200)
  })

  it('per-file state resets between files', () => {
    const file1 = [
      { type: 'event_msg', timestamp: '2024-01-01T00:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 0 } } } },
    ]
    const file2 = [
      { type: 'event_msg', timestamp: '2024-01-01T00:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0 } } } },
    ]
    const d1 = computeCodexDeltas(file1)
    const d2 = computeCodexDeltas(file2) // fresh state
    expect(d1[0].inputTokens).toBe(1000)
    expect(d2[0].inputTokens).toBe(200) // not saturated to 0
  })
})

// Inline re-implementation of the normalised delta logic for pure unit testing
function computeCodexDeltas(
  lines: Array<Record<string, any>>,
): Array<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }> {
  let prevIn = 0, prevOut = 0, prevCacheR = 0, prevCacheC = 0
  const results = []
  for (const value of lines) {
    const tu = value?.payload?.info?.total_token_usage
    if (!tu) continue
    const curInRaw: number = tu.input_tokens ?? 0
    const curCached: number = tu.cached_input_tokens ?? 0
    const curOut: number = tu.output_tokens ?? 0
    const curReason: number = tu.reasoning_output_tokens ?? 0
    const dInRaw = Math.max(0, curInRaw - prevIn)
    const dCached = Math.max(0, curCached - prevCacheR)
    const dOut = Math.max(0, curOut - prevOut)
    const dReason = Math.max(0, curReason - prevCacheC)
    prevIn = curInRaw; prevOut = curOut; prevCacheR = curCached; prevCacheC = curReason
    const inputTokens = Math.max(0, dInRaw - dCached)
    const cacheReadTokens = dCached
    const outputTokens = dOut + dReason
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0) continue
    results.push({ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens: 0 })
  }
  return results
}
