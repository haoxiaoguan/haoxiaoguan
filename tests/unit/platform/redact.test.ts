import { describe, it, expect } from 'vitest'
import { redactString, redactValue } from '../../../src/main/platform/log/redact'

// ─── redactString ───────────────────────────────────────────────────────────

describe('redactString', () => {
  it('Bearer token 替换', () => {
    expect(redactString('Authorization: Bearer abc123xyz')).toBe('Authorization: Bearer [REDACTED]')
  })

  it('Bearer token 大小写不敏感', () => {
    expect(redactString('authorization: bearer MyS3cr3tToken')).toContain('Bearer [REDACTED]')
  })

  it('JWT 三段式（裸，无 Bearer 前缀）', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(redactString(`token: ${jwt}`)).toBe('token: [REDACTED_JWT]')
  })

  it('Bearer 含 JWT 整体替换（不产生双重替换）', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const result = redactString(`Authorization: Bearer ${jwt}`)
    // Bearer 整体替换，不残留 [REDACTED_JWT]
    expect(result).toBe('Authorization: Bearer [REDACTED]')
    expect(result).not.toContain(jwt)
  })

  it('Basic credential 替换', () => {
    expect(redactString('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic [REDACTED]')
  })

  it('Basic 含 padding 的 base64', () => {
    expect(redactString('Basic dXNlcjpwYXNzd29yZA==')).toContain('Basic [REDACTED]')
  })

  it('inline accessToken=value 替换（保留键名）', () => {
    const result = redactString('accessToken=secret123abc')
    expect(result).toContain('accessToken')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('secret123abc')
  })

  it('inline refreshToken=value 替换', () => {
    const result = redactString('refreshToken=myRefresh99')
    expect(result).toContain('refreshToken')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('myRefresh99')
  })

  it('inline snake_case credential keys 替换', () => {
    const result = redactString(
      'access_token=access123 refresh_token=refresh456 api_key=sk-test client_secret=secret789 id_token=idtok',
    )
    expect(result).toContain('access_token=[REDACTED]')
    expect(result).toContain('refresh_token=[REDACTED]')
    expect(result).toContain('api_key=[REDACTED]')
    expect(result).toContain('client_secret=[REDACTED]')
    expect(result).toContain('id_token=[REDACTED]')
    expect(result).not.toContain('access123')
    expect(result).not.toContain('refresh456')
    expect(result).not.toContain('sk-test')
    expect(result).not.toContain('secret789')
    expect(result).not.toContain('idtok')
  })

  it('inline password=value 替换', () => {
    const result = redactString('password=hunter2')
    expect(result).toContain('password')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('hunter2')
  })

  it('inline secret=value 替换', () => {
    const result = redactString('secret=topsecret')
    expect(result).toContain('secret')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('topsecret')
  })

  it('普通字符串不被误截', () => {
    const safe = 'fetch exception: ECONNREFUSED 127.0.0.1:8080'
    expect(redactString(safe)).toBe(safe)
  })

  it('空字符串原样返回', () => {
    expect(redactString('')).toBe('')
  })

  it('多模式同时出现', () => {
    const s = 'Bearer tok123 and Basic dXNlcg== and password=abc'
    const result = redactString(s)
    expect(result).toContain('Bearer [REDACTED]')
    expect(result).toContain('Basic [REDACTED]')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('tok123')
    expect(result).not.toContain('dXNlcg==')
    expect(result).not.toContain('password=abc')
  })

  it('含冒号的普通错误消息不被误截', () => {
    const msg = 'connect ETIMEDOUT 203.0.113.1:443'
    expect(redactString(msg)).toBe(msg)
  })

  // ── JWT 正则收紧：确保非密文不被误打码（P1-2）──────────────────────────
  it('AWS 主机名不被误打码（oidc.region.amazonaws.com 首段不含 eyJ）', () => {
    const host = 'oidc.eucentral1.amazonaws.com'
    expect(redactString(host)).toBe(host)
  })

  it('下划线分隔的普通标识符不被误打码（foo_bar.baz_qux.config_value）', () => {
    const s = 'foo_bar.baz_qux.config_value'
    expect(redactString(s)).toBe(s)
  })

  it('普通方法调用链不被误打码（file.method.call）', () => {
    const s = 'file.method.call'
    expect(redactString(s)).toBe(s)
  })

  it('三段点分短串不被误打码（a.b.c）', () => {
    const s = 'a.b.c'
    expect(redactString(s)).toBe(s)
  })

  it('真 JWT（eyJ 开头）仍被打码', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(redactString(`token: ${jwt}`)).toBe('token: [REDACTED_JWT]')
    expect(redactString(`token: ${jwt}`)).not.toContain(jwt)
  })
})

// ─── redactValue ─────────────────────────────────────────────────────────────

describe('redactValue', () => {
  it('非对象原始值原样返回', () => {
    expect(redactValue(42)).toBe(42)
    expect(redactValue(true)).toBe(true)
    expect(redactValue(null)).toBeNull()
    expect(redactValue(undefined)).toBeUndefined()
  })

  it('字符串过 redactString', () => {
    expect(redactValue('Bearer tok123')).toBe('Bearer [REDACTED]')
  })

  it('敏感键整体替换为 [REDACTED]', () => {
    const obj = { token: 'abc', name: 'alice' }
    const result = redactValue(obj) as Record<string, unknown>
    expect(result.token).toBe('[REDACTED]')
    expect(result.name).toBe('alice')
  })

  it('大小写不敏感的敏感键', () => {
    const obj = { Authorization: 'Bearer tok', apiKey: 'key123', clientSecret: 'sec' }
    const result = redactValue(obj) as Record<string, unknown>
    expect(result.Authorization).toBe('[REDACTED]')
    expect(result.apiKey).toBe('[REDACTED]')
    expect(result.clientSecret).toBe('[REDACTED]')
  })

  it('snake_case 敏感键整体替换为 [REDACTED]', () => {
    const obj = {
      access_token: 'access123',
      refresh_token: 'refresh456',
      api_key: 'sk-test',
      client_secret: 'secret789',
      id_token: 'idtok',
      safe_value: 'visible',
    }
    const result = redactValue(obj) as Record<string, unknown>
    expect(result.access_token).toBe('[REDACTED]')
    expect(result.refresh_token).toBe('[REDACTED]')
    expect(result.api_key).toBe('[REDACTED]')
    expect(result.client_secret).toBe('[REDACTED]')
    expect(result.id_token).toBe('[REDACTED]')
    expect(result.safe_value).toBe('visible')
  })

  it('嵌套对象递归脱敏', () => {
    const obj = { outer: { inner: { password: 'p4ss' } } }
    const result = redactValue(obj) as { outer: { inner: { password: unknown } } }
    expect(result.outer.inner.password).toBe('[REDACTED]')
  })

  it('数组每个元素递归', () => {
    const arr = [{ token: 'abc' }, { safe: 'data' }]
    const result = redactValue(arr) as Array<Record<string, unknown>>
    expect(result[0].token).toBe('[REDACTED]')
    expect(result[1].safe).toBe('data')
  })

  it('原值不被变异（返回新对象）', () => {
    const obj = { password: 'original' }
    redactValue(obj)
    expect(obj.password).toBe('original')
  })

  it('数组原值不被变异', () => {
    const arr = [{ secret: 'keep' }]
    redactValue(arr)
    expect(arr[0].secret).toBe('keep')
  })

  it('maxDepth 截断超深对象', () => {
    // 构造深度 > 6 的嵌套
    let deep: unknown = { leaf: 'value' }
    for (let i = 0; i < 8; i++) deep = { level: deep }
    const result = redactValue(deep)
    // 顶层是对象，但深处超出 maxDepth 时返回 '[Object]'
    expect(JSON.stringify(result)).toContain('[Object]')
  })

  it('循环引用不崩溃，返回 [Circular]', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b', ref: a }
    a.ref = b // 循环：a → b → a
    expect(() => redactValue(a)).not.toThrow()
    const result = redactValue(a) as Record<string, unknown>
    // 子节点之一应该是 '[Circular]'
    expect(JSON.stringify(result)).toContain('[Circular]')
  })

  it('非敏感键的字符串值过 redactString', () => {
    const obj = { message: 'Bearer tok999' }
    const result = redactValue(obj) as Record<string, unknown>
    expect(result.message).toBe('Bearer [REDACTED]')
  })
})
