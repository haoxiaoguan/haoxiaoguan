import { describe, it, expect } from 'vitest'
import { makeRequestIntentParser } from '../../../src/main/contexts/apiProxy/domain/request-intent'
import { makePlatformAliasResolver } from '../../../src/main/contexts/apiProxy/domain/platform-alias'

// resolver：友好别名 kr→kiro（在 alias 表里）+ 平台名自身作前缀（echo/kiro 已“注册”）。
const resolve = makePlatformAliasResolver((n) => n === 'echo' || n === 'kiro')
const parse = makeRequestIntentParser(resolve)

describe('parseRequestIntent — bare routes', () => {
  it('GET /health', () => {
    expect(parse('GET', '/health')).toEqual({ format: 'openai', action: 'health', stream: false })
  })
  it('GET /v1/models', () => {
    expect(parse('GET', '/v1/models')).toEqual({ format: 'openai', action: 'models', stream: false })
  })
  it('GET /v1beta/models', () => {
    expect(parse('GET', '/v1beta/models')).toEqual({ format: 'gemini', action: 'models', stream: false })
  })
  it('POST /v1/chat/completions reads model + stream from body', () => {
    expect(parse('POST', '/v1/chat/completions', { model: 'echo-1', stream: true })).toEqual({
      format: 'openai', action: 'chat', model: 'echo-1', stream: true,
    })
  })
  it('POST /v1/chat/completions defaults stream=false', () => {
    expect(parse('POST', '/v1/chat/completions', { model: 'echo-1' })).toEqual({
      format: 'openai', action: 'chat', model: 'echo-1', stream: false,
    })
  })
  it('POST /v1/messages reads model + stream from body', () => {
    expect(parse('POST', '/v1/messages', { model: 'echo-1', stream: true })).toEqual({
      format: 'anthropic', action: 'messages', model: 'echo-1', stream: true,
    })
  })
  it('POST /v1/responses → format openai-responses, action responses', () => {
    expect(parse('POST', '/v1/responses', { model: 'gpt-4.1', stream: true })).toEqual({
      format: 'openai-responses', action: 'responses', model: 'gpt-4.1', stream: true,
    })
  })
  it('POST /v1beta/models/{model}:generateContent', () => {
    expect(parse('POST', '/v1beta/models/echo-1:generateContent', { contents: [] })).toEqual({
      format: 'gemini', action: 'generateContent', model: 'echo-1', stream: false,
    })
  })
  it('POST /v1beta/models/{model}:streamGenerateContent sets stream=true', () => {
    expect(parse('POST', '/v1beta/models/echo-1:streamGenerateContent', { contents: [] })).toEqual({
      format: 'gemini', action: 'generateContent', model: 'echo-1', stream: true,
    })
  })
  it('strips ?query before parsing', () => {
    expect(parse('POST', '/v1beta/models/echo-1:generateContent?key=abc', {})).toEqual({
      format: 'gemini', action: 'generateContent', model: 'echo-1', stream: false,
    })
  })
})

describe('parseRequestIntent — model 别名前缀路由', () => {
  it('友好别名 kr/<model> → platform=kiro，剥离前缀', () => {
    expect(parse('POST', '/v1/chat/completions', { model: 'kr/claude-sonnet-4.5' })).toEqual({
      platform: 'kiro', format: 'openai', action: 'chat', model: 'claude-sonnet-4.5', stream: false,
    })
  })
  it('平台名自身作前缀 echo/<model> → platform=echo', () => {
    expect(parse('POST', '/v1/messages', { model: 'echo/echo-1', stream: true })).toEqual({
      platform: 'echo', format: 'anthropic', action: 'messages', model: 'echo-1', stream: true,
    })
  })
  it('/v1/responses 同样支持别名前缀', () => {
    expect(parse('POST', '/v1/responses', { model: 'kr/x' })).toEqual({
      platform: 'kiro', format: 'openai-responses', action: 'responses', model: 'x', stream: false,
    })
  })
  it('未知前缀不剥离：第三方含斜杠模型名整串保留、无 platform', () => {
    expect(parse('POST', '/v1/chat/completions', { model: 'anthropic/claude-3.5-sonnet' })).toEqual({
      format: 'openai', action: 'chat', model: 'anthropic/claude-3.5-sonnet', stream: false,
    })
  })
  it('无前缀模型名 → 无 platform（按模型名路由）', () => {
    expect(parse('POST', '/v1/chat/completions', { model: 'claude-sonnet-4.5' })).toEqual({
      format: 'openai', action: 'chat', model: 'claude-sonnet-4.5', stream: false,
    })
  })
  it('别名对应平台未注册 → 不剥离（整串保留）', () => {
    const noKiro = makeRequestIntentParser(makePlatformAliasResolver((n) => n === 'echo'))
    expect(noKiro('POST', '/v1/chat/completions', { model: 'kr/claude' })).toEqual({
      format: 'openai', action: 'chat', model: 'kr/claude', stream: false,
    })
  })
})

describe('parseRequestIntent — unknown / invalid', () => {
  it('平台前缀 URL 已移除 → /kiro/v1/chat/completions 不再被识别（null）', () => {
    expect(parse('POST', '/kiro/v1/chat/completions', { model: 'x' })).toBeNull()
  })
  it('unknown bare path → null', () => {
    expect(parse('GET', '/does-not-exist')).toBeNull()
  })
  it('wrong method on a known path → null', () => {
    expect(parse('GET', '/v1/chat/completions')).toBeNull()
    expect(parse('POST', '/v1/models')).toBeNull()
  })
  it('gemini action without colon → null', () => {
    expect(parse('POST', '/v1beta/models/echo-1', {})).toBeNull()
  })
  it('gemini unsupported action → null', () => {
    expect(parse('POST', '/v1beta/models/echo-1:countTokens', {})).toBeNull()
  })
})
