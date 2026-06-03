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
  it('no configured keys + loopback + allowAnonymous → allow', () => {
    expect(authorizeClientKey({ isLoopback: true }, { keys: [], allowAnonymousLoopback: true })).toEqual({ ok: true })
  })
  it('no configured keys + non-loopback + allowAnonymous → missing (M5 护栏激活)', () => {
    expect(authorizeClientKey({ isLoopback: false }, { keys: [], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'missing' })
  })
  it('configured keys + matching Bearer → allow', () => {
    expect(authorizeClientKey({ authorization: 'Bearer s3cret', isLoopback: false }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toMatchObject({ ok: true })
  })
  it('configured keys + no key + loopback + allowAnonymous → 免 key 放行', () => {
    expect(authorizeClientKey({ isLoopback: true }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toEqual({ ok: true })
  })
  it('configured keys + wrong key → invalid', () => {
    expect(authorizeClientKey({ xApiKey: 'nope', isLoopback: false }, { keys: ['s3cret'], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'invalid' })
  })
  it('matches via x-goog-api-key and ?key= too', () => {
    expect(authorizeClientKey({ xGoogApiKey: 'k', isLoopback: false }, { keys: ['k'], allowAnonymousLoopback: false })).toMatchObject({ ok: true })
    expect(authorizeClientKey({ queryKey: 'k', isLoopback: false }, { keys: ['k'], allowAnonymousLoopback: false })).toMatchObject({ ok: true })
  })
})

const loopback = { isLoopback: true }
const remote = { isLoopback: false }

describe('authorizeClientKey loopback 护栏（M5）', () => {
  it('keys 空 + loopback + allowAnonymous → 放行', () => {
    expect(authorizeClientKey(loopback, { keys: [], allowAnonymousLoopback: true }).ok).toBe(true)
  })
  it('keys 空 + 非 loopback + allowAnonymous → 拒（missing）', () => {
    const d = authorizeClientKey(remote, { keys: [], allowAnonymousLoopback: true })
    expect(d).toEqual({ ok: false, reason: 'missing' })
  })
  it('keys 空 + loopback + !allowAnonymous → 拒', () => {
    expect(authorizeClientKey(loopback, { keys: [], allowAnonymousLoopback: false }).ok).toBe(false)
  })
  it('keys 非空 + loopback + 没带 key + allowAnonymous → 免 key 放行', () => {
    expect(authorizeClientKey(loopback, { keys: ['sk-x'], allowAnonymousLoopback: true }).ok).toBe(true)
  })
  it('keys 非空 + 非 loopback + 没带 key → 拒（missing）', () => {
    expect(authorizeClientKey(remote, { keys: ['sk-x'], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'missing' })
  })
  it('keys 非空 + 带正确 key → 放行（keyId）', () => {
    expect(authorizeClientKey({ ...remote, authorization: 'Bearer sk-x' }, { keys: ['sk-x'], allowAnonymousLoopback: false })).toEqual({ ok: true, keyId: 'sk-x' })
  })
  it('keys 非空 + 带错误 key → 拒（invalid）', () => {
    expect(authorizeClientKey({ ...remote, authorization: 'Bearer wrong' }, { keys: ['sk-x'], allowAnonymousLoopback: true })).toEqual({ ok: false, reason: 'invalid' })
  })
})
