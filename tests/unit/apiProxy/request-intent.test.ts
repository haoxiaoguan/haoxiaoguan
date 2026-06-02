import { describe, it, expect } from 'vitest'
import { makeRequestIntentParser } from '../../../src/main/contexts/apiProxy/domain/request-intent'

const parse = makeRequestIntentParser(new Set(['echo', 'kiro']))

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

describe('parseRequestIntent — platform-prefixed routes', () => {
  it('POST /echo/v1/chat/completions sets platform=echo', () => {
    expect(parse('POST', '/echo/v1/chat/completions', { model: 'echo-1' })).toEqual({
      platform: 'echo', format: 'openai', action: 'chat', model: 'echo-1', stream: false,
    })
  })
  it('POST /kiro/v1/messages sets platform=kiro', () => {
    expect(parse('POST', '/kiro/v1/messages', { model: 'claude' })).toEqual({
      platform: 'kiro', format: 'anthropic', action: 'messages', model: 'claude', stream: false,
    })
  })
  it('POST /echo/v1beta/models/echo-1:generateContent', () => {
    expect(parse('POST', '/echo/v1beta/models/echo-1:generateContent', {})).toEqual({
      platform: 'echo', format: 'gemini', action: 'generateContent', model: 'echo-1', stream: false,
    })
  })
  it('GET /echo/v1/models scopes models to platform', () => {
    expect(parse('GET', '/echo/v1/models')).toEqual({
      platform: 'echo', format: 'openai', action: 'models', stream: false,
    })
  })
})

describe('parseRequestIntent — unknown / invalid', () => {
  it('unknown platform prefix → null (404 semantics)', () => {
    expect(parse('POST', '/nope/v1/chat/completions', { model: 'x' })).toBeNull()
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
