import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeRollout } from '../../../src/main/contexts/sessions/infrastructure/codex-rollout-rewrite'
import {
  streamScanRollout,
  streamRewriteRollout,
} from '../../../src/main/contexts/sessions/infrastructure/codex-rollout-stream'

const tmps: string[] = []
function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hxg-rollout-stream-'))
  tmps.push(dir)
  const p = join(dir, 'rollout-test.jsonl')
  writeFileSync(p, content, 'utf8')
  return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const meta = (id: string, provider: string, cwd?: string) =>
  JSON.stringify({ type: 'session_meta', payload: { id, model_provider: provider, ...(cwd ? { cwd } : {}) } })
const ev = (obj: unknown) => JSON.stringify(obj)

// 各类换行/结构的语料：流式路径必须与整文件 analyzeRollout 产出逐字节一致。
const CASES: Record<string, string> = {
  'lf + trailing': `${meta('t1', 'hxg_x', '/work/a')}\n${ev({ type: 'event_msg', text: 'user_message hi' })}\n`,
  'crlf + trailing': `${meta('t2', 'hxg_x')}\r\n${ev({ type: 'response' })}\r\n`,
  'no trailing newline': `${meta('t3', 'hxg_x')}\n${ev({ type: 'response' })}`,
  'multiple session_meta': `${meta('t4', 'hxg_x')}\n${ev({ type: 'response' })}\n${meta('t4b', 'hxg_y')}\n`,
  'already on target': `${meta('t5', 'openai')}\n${ev({ type: 'response' })}\n`,
  'no session_meta': `${ev({ type: 'response', text: 'user_input here' })}\n${ev({ type: 'x' })}\n`,
  'blank lines preserved': `${meta('t6', 'hxg_x')}\n\n${ev({ type: 'response' })}\n`,
}

describe('codex-rollout-stream 与 analyzeRollout 等价', () => {
  const target = 'openai'

  for (const [name, content] of Object.entries(CASES)) {
    it(`streamScanRollout 元数据等价：${name}`, async () => {
      const a = analyzeRollout(content, target)
      const s = await streamScanRollout(tmpFile(content), target)
      expect(s.rewriteNeeded).toBe(a.rewriteNeeded)
      expect(s.sessionMetaCount).toBe(a.sessionMetaCount)
      expect(s.threadId).toBe(a.threadId)
      expect(s.cwd).toBe(a.cwd)
      expect(s.hasUserEvent).toBe(a.hasUserEvent)
      expect(s.originalSessionMetaLines).toEqual(a.originalSessionMetaLines)
    })

    it(`streamRewriteRollout 输出字节一致：${name}`, async () => {
      const a = analyzeRollout(content, target)
      const p = tmpFile(content)
      await streamRewriteRollout(p, target)
      expect(readFileSync(p, 'utf8')).toBe(a.nextText)
    })
  }

  it('大单行（>16MB，不可能是 session_meta）原样透传，且其余行正常改写', async () => {
    const big = 'x'.repeat(17 * 1024 * 1024)
    const content = `${meta('tb', 'hxg_x')}\n${ev({ type: 'response', blob: big })}\n`
    const p = tmpFile(content)
    await streamRewriteRollout(p, target)
    const out = readFileSync(p, 'utf8')
    // session_meta 已改写为 openai
    expect(out.split('\n')[0]).toContain('"model_provider":"openai"')
    // 大行原样保留
    expect(out).toContain(big)
  })
})
