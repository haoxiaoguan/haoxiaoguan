import { describe, it, expect } from 'vitest'
import {
  buildCursorSessionTokenValue,
  cursorCheckoutUrl,
} from '../../../src/main/contexts/account/domain/cursor-checkout'

// 构造一个 payload 里带指定 sub 的 JWT（第三段签名随意）。
function jwtWithSub(sub: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
    'base64url',
  )
  const payload = Buffer.from(
    JSON.stringify(sub === undefined ? {} : { sub }),
    'utf8',
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('cursorCheckoutUrl', () => {
  it('拼出每档的结账 URL', () => {
    const base = 'https://cursor.com/api/auth/checkoutDeepControl?yearly=false'
    expect(cursorCheckoutUrl('pro')).toBe(`${base}&tier=pro`)
    expect(cursorCheckoutUrl('pro_plus')).toBe(`${base}&tier=pro_plus`)
    expect(cursorCheckoutUrl('ultra')).toBe(`${base}&tier=ultra`)
  })
})

describe('buildCursorSessionTokenValue', () => {
  it('从 auth0|user_ 的 sub 提取 workos id，拼成 %3A%3A cookie 值', () => {
    const jwt = jwtWithSub('auth0|user_01KX5BAYZ')
    expect(buildCursorSessionTokenValue(jwt)).toBe(`user_01KX5BAYZ%3A%3A${jwt}`)
  })

  it('接受不带 provider 前缀的裸 user_ sub', () => {
    const jwt = jwtWithSub('user_01ABC')
    expect(buildCursorSessionTokenValue(jwt)).toBe(`user_01ABC%3A%3A${jwt}`)
  })

  it('sub 不是 user_ 开头 → undefined', () => {
    expect(buildCursorSessionTokenValue(jwtWithSub('google-oauth2|12345'))).toBeUndefined()
    expect(buildCursorSessionTokenValue(jwtWithSub('auth0|abc'))).toBeUndefined()
  })

  it('缺 sub / 非法 token → undefined', () => {
    expect(buildCursorSessionTokenValue(jwtWithSub(undefined))).toBeUndefined()
    expect(buildCursorSessionTokenValue('not-a-jwt')).toBeUndefined()
    expect(buildCursorSessionTokenValue('')).toBeUndefined()
    expect(buildCursorSessionTokenValue('a.b')).toBeUndefined()
  })
})
