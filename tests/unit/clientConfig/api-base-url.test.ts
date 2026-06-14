import { describe, it, expect } from 'vitest'
import { resolveApiBaseUrl } from '../../../src/main/contexts/clientConfig/infrastructure/api-base-url'
import { upsertCodexProvider, normalizeCodexBaseUrl, codexProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/codex-toml'

describe('resolveApiBaseUrl', () => {
  describe('fullUrl=false（默认启发式，向后兼容）', () => {
    it('无路径 → 补 /v1（OpenAI 兼容惯例）', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080', false)).toBe('http://127.0.0.1:8080/v1')
      expect(resolveApiBaseUrl('https://api.deepseek.com', false)).toBe('https://api.deepseek.com/v1')
    })
    it('尾斜杠剔除后仍按无路径 → 补 /v1', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080/', false)).toBe('http://127.0.0.1:8080/v1')
      expect(resolveApiBaseUrl('http://127.0.0.1:8080///', false)).toBe('http://127.0.0.1:8080/v1')
    })
    it('已带路径（网关 / 已含 /v1）→ 原样尊重，不重复补', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080/v1', false)).toBe('http://127.0.0.1:8080/v1')
      expect(resolveApiBaseUrl('https://gw.example.com/openai', false)).toBe('https://gw.example.com/openai')
      expect(resolveApiBaseUrl('https://gw.example.com/openai/v1/', false)).toBe('https://gw.example.com/openai/v1')
    })
    it('非 URL 原样返回（剥尾斜杠）', () => {
      expect(resolveApiBaseUrl('not a url/', false)).toBe('not a url')
    })
  })

  describe('fullUrl=true（用户声明完整 URL，一律不补 /v1）', () => {
    it('无路径也原样使用（自建无 /v1 服务）', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080', true)).toBe('http://127.0.0.1:8080')
    })
    it('已含 /v1 原样使用（不双 v1）', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080/v1', true)).toBe('http://127.0.0.1:8080/v1')
    })
    it('剥尾斜杠', () => {
      expect(resolveApiBaseUrl('http://127.0.0.1:8080/v1/', true)).toBe('http://127.0.0.1:8080/v1')
    })
  })

  it('normalizeCodexBaseUrl 等价于 resolveApiBaseUrl(url, false)（账号注入仍走启发式）', () => {
    for (const u of ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/', 'https://gw.example.com/openai', 'https://api.x.com/v1']) {
      expect(normalizeCodexBaseUrl(u)).toBe(resolveApiBaseUrl(u, false))
    }
  })
})

describe('upsertCodexProvider base_url（完整 URL 开关贯通到 config.toml）', () => {
  const base = (input: { baseUrl: string; fullUrl?: boolean }) =>
    upsertCodexProvider({}, {
      id: codexProviderId('p1'),
      name: 'X',
      baseUrl: input.baseUrl,
      bearerToken: 'k',
      isDefault: false,
      ...(input.fullUrl !== undefined ? { fullUrl: input.fullUrl } : {}),
    })

  const readBase = (obj: Record<string, unknown>): string => {
    const providers = obj.model_providers as Record<string, { base_url: string }>
    return providers[codexProviderId('p1')].base_url
  }

  it('fullUrl 缺省 → 启发式补 /v1（兼容老档）', () => {
    expect(readBase(base({ baseUrl: 'http://127.0.0.1:8080' }))).toBe('http://127.0.0.1:8080/v1')
  })
  it('fullUrl=false → 启发式补 /v1', () => {
    expect(readBase(base({ baseUrl: 'http://127.0.0.1:8080', fullUrl: false }))).toBe('http://127.0.0.1:8080/v1')
  })
  it('fullUrl=true + 无路径 → 原样写入（不补 /v1）', () => {
    expect(readBase(base({ baseUrl: 'http://127.0.0.1:8080', fullUrl: true }))).toBe('http://127.0.0.1:8080')
  })
  it('fullUrl=true + 已含 /v1 → 原样写入（不双 v1）', () => {
    expect(readBase(base({ baseUrl: 'http://127.0.0.1:8080/v1', fullUrl: true }))).toBe('http://127.0.0.1:8080/v1')
  })
})
