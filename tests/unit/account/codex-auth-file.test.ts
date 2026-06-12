import { describe, it, expect } from 'vitest'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import {
  buildCodexAuthFileValue,
  isCodexApiKeyCredential,
} from '../../../src/main/agents/credential-injection/codex-auth-file'

// 构造一个带 chatgpt_account_id claim 的假 JWT（alg none，仅 payload 可解）。
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('isCodexApiKeyCredential', () => {
  it('auth_mode=api_key / apikey → API Key', () => {
    expect(isCodexApiKeyCredential(new Credential('sk-x', undefined, undefined, { auth_mode: 'api_key' }))).toBe(true)
    expect(isCodexApiKeyCredential(new Credential('sk-x', undefined, undefined, { auth_mode: 'apikey' }))).toBe(true)
  })

  it('auth_mode=chatgpt_oauth → OAuth', () => {
    expect(isCodexApiKeyCredential(new Credential(fakeJwt({}), 'rt', undefined, { auth_mode: 'chatgpt_oauth' }))).toBe(false)
  })

  it('无 auth_mode：有 refresh_token 或 JWT 形态 → OAuth；sk- 前缀 → API Key', () => {
    expect(isCodexApiKeyCredential(new Credential(fakeJwt({}), 'rt'))).toBe(false)
    expect(isCodexApiKeyCredential(new Credential(fakeJwt({})))).toBe(false)
    expect(isCodexApiKeyCredential(new Credential('sk-proj-abc'))).toBe(true)
  })
})

describe('buildCodexAuthFileValue', () => {
  it('OAuth 账号写官方 tokens 结构 + last_refresh（对照 Rust build_auth_file_value）', () => {
    const access = fakeJwt({ exp: 9999999999 })
    const cred = new Credential(access, 'refresh-1', undefined, {
      auth_mode: 'chatgpt_oauth',
      id_token: 'id-1',
      account_id: 'acc-1',
    })
    const value = buildCodexAuthFileValue(cred) as Record<string, unknown>
    expect(value.OPENAI_API_KEY).toBeNull()
    expect(value.tokens).toEqual({
      id_token: 'id-1',
      access_token: access,
      refresh_token: 'refresh-1',
      account_id: 'acc-1',
    })
    // last_refresh 形如 2026-06-12T03:25:01.123000Z（6 位小数秒）
    expect(value.last_refresh).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    expect(value.auth_mode).toBeUndefined()
  })

  it('OAuth 缺 refresh_token/account_id 时按 Rust skip_serializing_if 省略字段', () => {
    const access = fakeJwt({})
    const value = buildCodexAuthFileValue(
      new Credential(access, undefined, undefined, { auth_mode: 'chatgpt_oauth' }),
    ) as Record<string, unknown>
    const tokens = value.tokens as Record<string, unknown>
    expect(tokens.id_token).toBe('') // Rust 必填 String，缺失写空串
    expect('refresh_token' in tokens).toBe(false)
    expect('account_id' in tokens).toBe(false)
  })

  it('account_id 缺失时回退 access JWT 的 chatgpt_account_id claim', () => {
    const access = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'from-jwt' } })
    const value = buildCodexAuthFileValue(
      new Credential(access, 'rt', undefined, { auth_mode: 'chatgpt_oauth' }),
    ) as Record<string, unknown>
    expect((value.tokens as Record<string, unknown>).account_id).toBe('from-jwt')
  })

  it('嵌套 tokens 元数据也可作为 id_token/refresh_token 来源', () => {
    const access = fakeJwt({})
    const value = buildCodexAuthFileValue(
      new Credential(access, undefined, undefined, {
        auth_mode: 'chatgpt_oauth',
        tokens: { id_token: 'nested-id', refresh_token: 'nested-rt' },
      }),
    ) as Record<string, unknown>
    const tokens = value.tokens as Record<string, unknown>
    expect(tokens.id_token).toBe('nested-id')
    expect(tokens.refresh_token).toBe('nested-rt')
  })

  it('API Key 账号写 {auth_mode:"apikey", OPENAI_API_KEY}', () => {
    const value = buildCodexAuthFileValue(
      new Credential('sk-live-1', undefined, undefined, { auth_mode: 'api_key', api_key: 'sk-live-1' }),
    )
    expect(value).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-live-1' })
  })

  it('缺必要材料时抛错而不是写半残文件', () => {
    expect(() =>
      buildCodexAuthFileValue(new Credential('', undefined, undefined, { auth_mode: 'chatgpt_oauth' })),
    ).toThrow(/access_token/)
    expect(() =>
      buildCodexAuthFileValue(new Credential('  ', undefined, undefined, { auth_mode: 'api_key' })),
    ).toThrow(/OPENAI_API_KEY/)
  })
})
