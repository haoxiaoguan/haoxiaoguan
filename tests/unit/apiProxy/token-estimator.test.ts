import { describe, it, expect } from 'vitest'
import { countTextTokens, estimateRequestInputTokens, isOfficialTokenizerAvailable } from '../../../src/main/contexts/apiProxy/domain/usage/token-estimator'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

describe('isOfficialTokenizerAvailable', () => {
  it('本机 Node 环境官方 tokenizer 可用，返回 true', () => {
    // @anthropic-ai/tokenizer 纯 JS，无 WASM/native，Node 单测环境应正常加载。
    // false 路径由 getOfficial() 的 try/catch 覆盖（require 失败时静默返回 null），
    // 此处不强制 mock require 失败，避免过度侵入模块缓存。
    expect(isOfficialTokenizerAvailable()).toBe(true)
  })
})

describe('countTextTokens', () => {
  it('空串 = 0', () => { expect(countTextTokens('')).toBe(0) })
  it('英文文本 > 0 且与字符数同量级', () => {
    const n = countTextTokens('The quick brown fox jumps over the lazy dog.')
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThan(44)
  })
  it('中文文本 > 0', () => { expect(countTextTokens('你好，世界，这是一段中文。')).toBeGreaterThan(3) })
})

describe('estimateRequestInputTokens', () => {
  it('累加 system + messages + tools 文本', () => {
    const req: CanonicalRequest = {
      model: 'claude-sonnet-4.5',
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello there, how are you?' }] }],
      tools: [{ name: 'get_weather', description: 'Get weather', inputSchema: { type: 'object' } }],
      stream: false,
    }
    expect(estimateRequestInputTokens(req)).toBeGreaterThan(10)
  })
  it('空消息 → 至少 1', () => {
    const req: CanonicalRequest = { model: 'x', messages: [], stream: false }
    expect(estimateRequestInputTokens(req)).toBeGreaterThanOrEqual(1)
  })
})
