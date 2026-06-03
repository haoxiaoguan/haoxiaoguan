import { describe, it, expect } from 'vitest'
import { isSuspendedResponse, KiroUpstreamSuspendedError, classifyKiroError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import { KiroUpstreamAuthError, KiroUpstreamError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'

describe('isSuspendedResponse', () => {
  it('403 + TEMPORARILY_SUSPENDED', () => {
    expect(isSuspendedResponse(403, '{"reason":"TEMPORARILY_SUSPENDED"}')).toBe(true)
  })
  it('403 + suspended 文本 / AccountSuspendedException', () => {
    expect(isSuspendedResponse(403, 'User ID is suspended')).toBe(true)
    expect(isSuspendedResponse(403, 'AccountSuspendedException')).toBe(true)
  })
  it('423 Locked 即挂起', () => {
    expect(isSuspendedResponse(423, '')).toBe(true)
  })
  it('普通 403 不是挂起', () => {
    expect(isSuspendedResponse(403, 'invalid bearer token')).toBe(false)
  })
})

describe('classifyKiroError', () => {
  it('Suspended → SUSPENDED', () => {
    expect(classifyKiroError(new KiroUpstreamSuspendedError('x', 403))).toBe('SUSPENDED')
  })
  it('Auth → AUTH', () => {
    expect(classifyKiroError(new KiroUpstreamAuthError('x', 401))).toBe('AUTH')
  })
  it('429 → RATE_LIMIT', () => {
    expect(classifyKiroError(new KiroUpstreamError('x', 429))).toBe('RATE_LIMIT')
  })
  it('5xx / 网络 → SERVER', () => {
    expect(classifyKiroError(new KiroUpstreamError('x', 502))).toBe('SERVER')
    expect(classifyKiroError(new Error('socket hang up'))).toBe('SERVER')
  })
  it('400/422 → FATAL', () => {
    expect(classifyKiroError(new KiroUpstreamError('x', 400))).toBe('FATAL')
    expect(classifyKiroError(new KiroUpstreamError('x', 422))).toBe('FATAL')
  })
})
