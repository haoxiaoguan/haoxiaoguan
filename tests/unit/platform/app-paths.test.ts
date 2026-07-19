import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectAppPath,
  verifyCodexDarwinBundle,
  CODEX_MAC_BUNDLE_ID,
} from '../../../src/main/platform/identity/app-paths'

// app-paths probes the real filesystem for OS-specific install locations. We
// can't write to /Applications, so these tests assert the OS-aware *suggestion*
// (deterministic, no disk) and the unknown-platform contract. The "detected"
// path is environment-dependent and only asserted to be null-or-existing.
describe('detectAppPath', () => {
  it('returns a platform+OS-appropriate suggestion for known platforms', async () => {
    const info = await detectAppPath('kiro')
    expect(typeof info.suggestion).toBe('string')
    expect(info.suggestion.length).toBeGreaterThan(0)
    if (process.platform === 'darwin') {
      expect(info.suggestion).toBe('/Applications/Kiro.app')
    } else if (process.platform === 'win32') {
      expect(info.suggestion.toLowerCase()).toContain('kiro.exe')
    } else {
      expect(info.suggestion).toContain('kiro')
    }
  })

  it('accepts kebab frontend ids (gemini-cli, codebuddy-cn)', async () => {
    // gemini-cli has no app candidates (CLI) → empty suggestion, never throws.
    expect(await detectAppPath('gemini-cli')).toEqual({ detected: null, suggestion: '' })
    // codebuddy-cn is a known multi-word kebab id with candidates.
    const cn = await detectAppPath('codebuddy-cn')
    if (process.platform === 'darwin') {
      expect(cn.suggestion).toBe('/Applications/CodeBuddy CN.app')
    }
  })

  it('returns a neutral result for an unknown platform', async () => {
    expect(await detectAppPath('not-a-platform')).toEqual({ detected: null, suggestion: '' })
  })

  it('detects an existing macOS bundle when present', async () => {
    if (process.platform !== 'darwin') return
    const info = await detectAppPath('kiro')
    if (info.detected !== null) {
      expect(info.detected).toBe(info.suggestion)
    }
  })

  // Codex→ChatGPT 改名：新名优先、旧名回退。
  it('codex on macOS: suggestion 是新名 ChatGPT.app', async () => {
    if (process.platform !== 'darwin') return
    const info = await detectAppPath('codex')
    expect(info.suggestion).toBe('/Applications/ChatGPT.app')
    // detected 依环境而定：null 或两个官方路径之一。
    if (info.detected !== null) {
      expect(['/Applications/ChatGPT.app', '/Applications/Codex.app']).toContain(info.detected)
    }
  })
})

// ChatGPT.app 候选的 bundle id 排歧义校验（旧聊天助手 com.openai.chat 与
// 改名后的 Codex App com.openai.codex 都叫 ChatGPT.app）。
describe('verifyCodexDarwinBundle', () => {
  it('读到 com.openai.codex → 通过', async () => {
    const ok = await verifyCodexDarwinBundle('/Applications/ChatGPT.app', async () => ({
      stdout: `${CODEX_MAC_BUNDLE_ID}\n`,
    }))
    expect(ok).toBe(true)
  })

  it('读到其它 bundle id(旧聊天助手) → 拒绝', async () => {
    const ok = await verifyCodexDarwinBundle('/Applications/ChatGPT.app', async () => ({
      stdout: 'com.openai.chat\n',
    }))
    expect(ok).toBe(false)
  })

  it('defaults 命令失败 → 放行(校验只用于排歧义，不阻断探测)', async () => {
    const ok = await verifyCodexDarwinBundle('/Applications/ChatGPT.app', async () => {
      throw new Error('defaults boom')
    })
    expect(ok).toBe(true)
  })
})

// Cross-platform sanity: unknown platform stays neutral regardless of disk.
describe('detectAppPath (temp-dir smoke)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apppath-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates and removes a temp dir without affecting detection', async () => {
    mkdirSync(join(dir, 'Fake.app'))
    expect(await detectAppPath('unknown')).toEqual({ detected: null, suggestion: '' })
  })
})
