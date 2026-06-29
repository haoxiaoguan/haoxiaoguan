import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, utimes } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeRollout,
  toDesktopWorkspacePath,
  writeRolloutPreservingMtime,
  rewriteRolloutLines,
} from '../../../src/main/contexts/sessions/infrastructure/codex-rollout-rewrite'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-rollout-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

// ─── toDesktopWorkspacePath ───────────────────────────────────────────────────

describe('toDesktopWorkspacePath', () => {
  it('空字符串/空白 → undefined', () => {
    expect(toDesktopWorkspacePath('')).toBeUndefined()
    expect(toDesktopWorkspacePath('   ')).toBeUndefined()
  })

  it('macOS 普通绝对路径 → 原样返回', () => {
    expect(toDesktopWorkspacePath('/Users/foo/bar')).toBe('/Users/foo/bar')
    expect(toDesktopWorkspacePath('  /Users/foo/bar  ')).toBe('/Users/foo/bar')
  })

  it('\\\\?\\UNC\\ 前缀 → \\\\ + 剩余(/ → \\)', () => {
    // \\?\UNC\server\share → \\server\share
    expect(toDesktopWorkspacePath('\\\\?\\UNC\\server\\share')).toBe('\\\\server\\share')
  })

  it('\\\\?\\ 前缀 → 去掉前缀后 \\ → /', () => {
    // \\?\C:\Users\foo → C:/Users/foo
    expect(toDesktopWorkspacePath('\\\\?\\C:\\Users\\foo')).toBe('C:/Users/foo')
  })
})

// ─── analyzeRollout ───────────────────────────────────────────────────────────

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

describe('analyzeRollout', () => {
  it('单个 session_meta — 需要改写时 rewriteNeeded=true', () => {
    const meta = { type: 'session_meta', payload: { id: 'tid1', cwd: '/home/u', model_provider: 'openai', model: 'gpt-old' } }
    const other = { type: 'response_item', payload: { content: 'hi' } }
    const text = [line(meta), line(other)].join('\n')
    const r = analyzeRollout(text, 'hxg_x', 'glm-new')
    expect(r.rewriteNeeded).toBe(true)
    expect(r.sessionMetaCount).toBe(1)
    expect(r.threadId).toBe('tid1')
    expect(r.cwd).toBe('/home/u')
    expect(r.providers).toEqual(['openai'])
    expect(r.hasUserEvent).toBe(false)
    expect(r.hasEncrypted).toBe(false)
    expect(r.originalSessionMetaLines).toEqual([line(meta)])
    // nextText 中 session_meta 行应有 hxg_x
    const outLines = r.nextText.split('\n')
    expect(JSON.parse(outLines[0]).payload.model_provider).toBe('hxg_x')
    expect(JSON.parse(outLines[0]).payload.model).toBe('glm-new')
    // non-session_meta 行原样
    expect(outLines[1]).toBe(line(other))
  })

  it('provider 已是 target 但 model 不一致时也改写', () => {
    const meta = { type: 'session_meta', payload: { id: 'tid1', cwd: '/a', model_provider: 'hxg_x', model: 'glm-old' } }
    const text = line(meta)
    const r = analyzeRollout(text, 'hxg_x', 'glm-new')
    expect(r.rewriteNeeded).toBe(true)
    const out = JSON.parse(r.nextText) as { payload: { model_provider: string; model: string } }
    expect(out.payload.model_provider).toBe('hxg_x')
    expect(out.payload.model).toBe('glm-new')
  })

  it('多个 session_meta 行 — 全部改写', () => {
    const meta1 = { type: 'session_meta', payload: { id: 'tid1', cwd: '/a', model_provider: 'openai' } }
    const meta2 = { type: 'session_meta', payload: { id: 'tid2', cwd: '/b', model_provider: 'custom' } }
    const text = [line(meta1), line(meta2)].join('\n')
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.rewriteNeeded).toBe(true)
    expect(r.sessionMetaCount).toBe(2)
    expect(r.threadId).toBe('tid1')  // 首个
    expect(r.cwd).toBe('/a')         // 首个
    expect(r.providers).toEqual(['openai', 'custom'])
    expect(r.originalSessionMetaLines).toHaveLength(2)
    const outLines = r.nextText.split('\n')
    expect(JSON.parse(outLines[0]).payload.model_provider).toBe('hxg_x')
    expect(JSON.parse(outLines[1]).payload.model_provider).toBe('hxg_x')
  })

  it('已是 target — rewriteNeeded=false', () => {
    const meta = { type: 'session_meta', payload: { id: 'tid1', cwd: '/a', model_provider: 'hxg_x' } }
    const text = line(meta)
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.rewriteNeeded).toBe(false)
    expect(r.sessionMetaCount).toBe(1)
    expect(r.providers).toEqual(['hxg_x'])
    expect(r.nextText).toBe(text)
  })

  it('provider 缺失时记录 "(missing)"', () => {
    const meta = { type: 'session_meta', payload: { id: 'tid1' } }
    const text = line(meta)
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.providers).toEqual(['(missing)'])
    expect(r.rewriteNeeded).toBe(true)
  })

  it('hasUserEvent — 含 user_message 或 user_input', () => {
    const meta = { type: 'session_meta', payload: { id: 't', model_provider: 'openai' } }
    const ev = { type: 'user_message', payload: {} }
    const text = [line(meta), line(ev)].join('\n')
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.hasUserEvent).toBe(true)
  })

  it('hasEncrypted — 含 encrypted_content', () => {
    const meta = { type: 'session_meta', payload: { id: 't', model_provider: 'openai' } }
    const enc = { type: 'response_item', payload: { encrypted_content: 'xxx' } }
    const text = [line(meta), line(enc)].join('\n')
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.hasEncrypted).toBe(true)
  })

  it('保留行尾 \\r\\n', () => {
    const meta = { type: 'session_meta', payload: { id: 't', model_provider: 'openai' } }
    const other = { type: 'response_item', payload: {} }
    const text = line(meta) + '\r\n' + line(other) + '\r\n'
    const r = analyzeRollout(text, 'hxg_x')
    // nextText 每行仍以 \r\n 结尾
    const parts = r.nextText.split('\r\n')
    expect(parts).toHaveLength(3) // line1, line2, empty after last \r\n
    expect(JSON.parse(parts[0]).payload.model_provider).toBe('hxg_x')
    expect(parts[1]).toBe(line(other))
  })

  it('非 session_meta 行不动', () => {
    const other = { type: 'response_item', payload: { x: 1 } }
    const text = line(other) + '\n'
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.sessionMetaCount).toBe(0)
    expect(r.rewriteNeeded).toBe(false)
    expect(r.nextText).toBe(text)
  })

  it('最后一行无行尾时保留无行尾', () => {
    const meta = { type: 'session_meta', payload: { id: 't', model_provider: 'openai' } }
    const text = line(meta)  // no trailing newline
    const r = analyzeRollout(text, 'hxg_x')
    expect(r.nextText.endsWith('\n')).toBe(false)
  })
})

// ─── writeRolloutPreservingMtime ──────────────────────────────────────────────

describe('writeRolloutPreservingMtime', () => {
  it('写入内容后 mtime 恢复到原来的值', async () => {
    const p = join(dir, 'rollout.jsonl')
    await writeFile(p, 'original content')
    // 把 mtime 设置到过去 5 秒，确保可以对比
    const past = new Date(Date.now() - 5000)
    await utimes(p, past, past)
    const originalMtime = statSync(p).mtimeMs

    await writeRolloutPreservingMtime(p, 'new content')
    const newContent = await readFile(p, 'utf8')
    expect(newContent).toBe('new content')
    const afterMtime = statSync(p).mtimeMs
    // mtime 应当恢复到原来的值（允许 1s 误差，文件系统精度）
    expect(Math.abs(afterMtime - originalMtime)).toBeLessThan(1000)
  })
})

// ─── rewriteRolloutLines (rollback helper) ────────────────────────────────────

describe('rewriteRolloutLines', () => {
  it('把文件中的 session_meta 行依次替换为 originalLines', async () => {
    const p = join(dir, 'rollout.jsonl')
    const meta1 = { type: 'session_meta', payload: { id: 't', model_provider: 'hxg_x' } }
    const meta2 = { type: 'session_meta', payload: { id: 't2', model_provider: 'hxg_x' } }
    const other = { type: 'response_item', payload: {} }
    await writeFile(p, [line(meta1), line(other), line(meta2)].join('\n'))

    const orig1 = line({ type: 'session_meta', payload: { id: 't', model_provider: 'openai' } })
    const orig2 = line({ type: 'session_meta', payload: { id: 't2', model_provider: 'openai' } })
    await rewriteRolloutLines(p, [orig1, orig2])

    const outLines = (await readFile(p, 'utf8')).split('\n')
    expect(JSON.parse(outLines[0]).payload.model_provider).toBe('openai')
    expect(outLines[1]).toBe(line(other))
    expect(JSON.parse(outLines[2]).payload.model_provider).toBe('openai')
  })
})
