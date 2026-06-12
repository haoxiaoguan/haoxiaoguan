import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import TOML from '@iarna/toml'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import {
  computeCodexProviderConfig,
  CodexConfigProviderWriter,
} from '../../../src/main/agents/credential-injection/codex-config-provider'

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

const oauthCred = () =>
  new Credential(fakeJwt({}), 'rt', undefined, { auth_mode: 'chatgpt_oauth' })
const apiKeyCred = (extra: Record<string, unknown> = {}) =>
  new Credential('sk-live-123', undefined, undefined, { auth_mode: 'api_key', api_key: 'sk-live-123', ...extra })

describe('computeCodexProviderConfig', () => {
  it('API Key 账号写 codex_local_access provider（默认 openai/v1 + bearer）并指为默认', () => {
    const out = computeCodexProviderConfig({}, apiKeyCred())
    expect(out.model_provider).toBe('codex_local_access')
    const p = (out.model_providers as Record<string, Record<string, unknown>>).codex_local_access
    expect(p.base_url).toBe('https://api.openai.com/v1')
    expect(p.wire_api).toBe('responses')
    expect(p.requires_openai_auth).toBe(true)
    expect(p.experimental_bearer_token).toBe('sk-live-123')
    expect(p.supports_websockets).toBe(false)
  })

  it('API Key 账号带第三方 base_url：补 /v1 并写入', () => {
    const out = computeCodexProviderConfig({}, apiKeyCred({ base_url: 'https://gw.example.com' }))
    const p = (out.model_providers as Record<string, Record<string, unknown>>).codex_local_access
    expect(p.base_url).toBe('https://gw.example.com/v1')
  })

  it('OAuth 账号复位内置：删受管 provider 块 + 指向它的顶层默认 + openai_base_url', () => {
    const current = {
      model_provider: 'codex_local_access',
      openai_base_url: 'https://old.example.com/v1',
      model_providers: {
        codex_local_access: { base_url: 'x', experimental_bearer_token: 'old-key' },
      },
    }
    const out = computeCodexProviderConfig(current, oauthCred())
    expect(out.model_provider).toBeUndefined()
    expect(out.openai_base_url).toBeUndefined()
    expect(out.model_providers).toBeUndefined() // 唯一受管块删光后整表移除
  })

  it('OAuth 复位保留用户/客户端接入的 hxg_* provider 与指向它的默认', () => {
    const current = {
      model_provider: 'hxg_myprofile',
      model_providers: {
        codex_local_access: { experimental_bearer_token: 'stale' },
        hxg_myprofile: { base_url: 'https://user.example.com/v1' },
      },
    }
    const out = computeCodexProviderConfig(current, oauthCred())
    // 受管块被清，hxg_* 保留；顶层默认指向 hxg_* → 不动
    expect(out.model_provider).toBe('hxg_myprofile')
    const providers = out.model_providers as Record<string, unknown>
    expect(providers.codex_local_access).toBeUndefined()
    expect(providers.hxg_myprofile).toBeDefined()
  })

  it('API Key 缺密钥时抛错', () => {
    const bad = new Credential('  ', undefined, undefined, { auth_mode: 'api_key' })
    expect(() => computeCodexProviderConfig({}, bad)).toThrow(/密钥/)
  })
})

describe('CodexConfigProviderWriter', () => {
  it('OAuth 复位时 config.toml 不存在且无受管块 → 不创建空文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-cfg-'))
    const path = join(dir, 'config.toml')
    try {
      await new CodexConfigProviderWriter(path).apply(oauthCred())
      expect(existsSync(path)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('API Key → 写 provider；切到 OAuth → 清掉它，保留用户其它键', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-cfg-'))
    const path = join(dir, 'config.toml')
    try {
      writeFileSync(path, 'model = "gpt-5"\n[mcp_servers.foo]\ncommand = "bar"\n', 'utf8')
      const writer = new CodexConfigProviderWriter(path)

      await writer.apply(apiKeyCred())
      let parsed = TOML.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      expect(parsed.model_provider).toBe('codex_local_access')
      expect(parsed.model).toBe('gpt-5') // 用户键保留
      expect((parsed.mcp_servers as Record<string, unknown>).foo).toBeDefined()

      await writer.apply(oauthCred())
      parsed = TOML.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      expect(parsed.model_provider).toBeUndefined()
      expect(parsed.model_providers).toBeUndefined()
      expect(parsed.model).toBe('gpt-5')
      expect((parsed.mcp_servers as Record<string, unknown>).foo).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
