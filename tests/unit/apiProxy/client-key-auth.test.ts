import { describe, it, expect } from 'vitest'
import { extractClientKey, authorizeClientKey } from '../../../src/main/contexts/apiProxy/domain/client-key-auth'

describe('extractClientKey priority', () => {
  it('Authorization: Bearer wins', () => {
    expect(extractClientKey({ authorization: 'Bearer abc', xApiKey: 'x', isLoopback: false })).toBe('abc')
  })
  it('falls back to x-api-key', () => {
    expect(extractClientKey({ xApiKey: 'k', isLoopback: false })).toBe('k')
  })
  it('falls back to x-goog-api-key', () => {
    expect(extractClientKey({ xGoogApiKey: 'g', isLoopback: false })).toBe('g')
  })
  it('falls back to ?key=', () => {
    expect(extractClientKey({ queryKey: 'q', isLoopback: false })).toBe('q')
  })
  it('returns undefined when nothing present', () => {
    expect(extractClientKey({ isLoopback: false })).toBeUndefined()
  })
  it('ignores non-Bearer Authorization', () => {
    expect(extractClientKey({ authorization: 'Basic zzz', isLoopback: false })).toBeUndefined()
  })
})

describe('authorizeClientKey decisions', () => {
  it('no configured keys → allow (loopback)', () => {
    expect(authorizeClientKey({ isLoopback: true }, { keys: [], allowAnonymousLoopback: true })).toEqual({ ok: true })
  })
  it('no configured keys → allow even non-loopback (M2b: guardrail deferred to M5)', () => {
    expect(authorizeClientKey({ isLoopback: false }, { keys: [], allowAnonymousLoopback: true })).toEqual({ ok: true })
  })
  it('configured keys + matching Bearer → allow', () => {
    expect(authorizeClientKey({ authorization: 'Bearer s3cret', isLoopback: false }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toMatchObject({ ok: true })
  })
  it('configured keys + no key provided → missing', () => {
    expect(authorizeClientKey({ isLoopback: true }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'missing' })
  })
  it('configured keys + wrong key → invalid', () => {
    expect(authorizeClientKey({ xApiKey: 'nope', isLoopback: false }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'invalid' })
  })
  it('matches via x-goog-api-key and ?key= too', () => {
    expect(authorizeClientKey({ xGoogApiKey: 'k', isLoopback: false }, { keys: ['k'], allowAnonymousLoopback: false })).toMatchObject({ ok: true })
    expect(authorizeClientKey({ queryKey: 'k', isLoopback: false }, { keys: ['k'], allowAnonymousLoopback: false })).toMatchObject({ ok: true })
  })
})
