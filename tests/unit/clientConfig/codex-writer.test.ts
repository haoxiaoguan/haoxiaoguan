import { describe, it, expect } from 'vitest'
import TOML from '@iarna/toml'
import { CodexWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/codex-writer'
import { codexProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/codex-toml'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.codex/config.toml'
const CAT = '/home/u/.hxg/codex-model-catalog.json'
const AUTH = '/home/u/.codex/auth.json'
const w = new CodexWriter(P, CAT, AUTH)
const pid1 = codexProviderId('p1')
const pid2 = codexProviderId('p2')

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro', ...over }
}
const apply = (cur: FileBundle, inp = input()) => TOML.parse(w.renderApply(cur, inp)[P]!) as any

describe('CodexWriter (additive 注入)', () => {
  it('provider id 为 hxg_ 前缀且不含连字符（TOML 裸键安全、非保留 id）', () => {
    expect(pid1).toMatch(/^hxg_[a-zA-Z0-9]+$/)
  })

  it('文件不存在 → 注入 model_providers + profiles 段', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.model_providers[pid1].name).toBe('本机反代')
    expect(cfg.model_providers[pid1].base_url).toBe('http://127.0.0.1:8788/v1') // 无路径自动补 /v1
    expect(cfg.model_providers[pid1].wire_api).toBe('responses')
    // 关键：requires_openai_auth=true 让 Codex 桌面 App 保留 ChatGPT 登录态、不崩。
    expect(cfg.model_providers[pid1].requires_openai_auth).toBe(true)
    expect(cfg.model_providers[pid1].experimental_bearer_token).toBe('sk-hxg')
    expect(cfg.profiles[pid1].model_provider).toBe(pid1)
    expect(cfg.profiles[pid1].model).toBe('kiro')
  })

  it('isDefault → 写顶层 model_provider + model', () => {
    const cfg = apply({ [P]: null }, input({ isDefault: true }))
    expect(cfg.model_provider).toBe(pid1)
    expect(cfg.model).toBe('kiro')
  })

  it('非默认 → 不写顶层 model_provider', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.model_provider).toBeUndefined()
  })

  it('apiKey 为空 → 不写 experimental_bearer_token', () => {
    const cfg = apply({ [P]: null }, input({ apiKey: '' }))
    expect(cfg.model_providers[pid1].experimental_bearer_token).toBeUndefined()
  })

  it('两档共存：账号档 + 第三方档同时存在', () => {
    const after1 = w.renderApply({ [P]: null }, input())
    const after2 = w.renderApply(after1, input({ profileId: 'p2', name: '第三方GPT', baseUrl: 'https://t/v1', apiKey: 'k2', model: 'gpt-5' }))
    const cfg = TOML.parse(after2[P]!) as any
    expect(Object.keys(cfg.model_providers).sort()).toEqual([pid1, pid2].sort())
    expect(cfg.profiles[pid2].model).toBe('gpt-5')
  })

  it('保留用户已有 config（mcp_servers / 自有 model_provider 不动）', () => {
    const existing = [
      'model_provider = "openai"',
      'model = "gpt-5"',
      '',
      '[model_providers.openai]',
      'name = "OpenAI"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
    ].join('\n')
    const cfg = apply({ [P]: existing })
    expect(cfg.model_providers.openai.name).toBe('OpenAI') // 用户自有 provider 保留
    expect(cfg.mcp_servers.context7.command).toBe('npx') // mcp 不动
    expect(cfg.model_providers[pid1]).toBeDefined() // 号小管段注入
    expect(cfg.model_provider).toBe('openai') // 非默认注入不改用户的活动 provider
  })

  it('renderClear 只移除本档段，保留他档与用户配置', () => {
    let bundle: FileBundle = { [P]: null }
    bundle = w.renderApply(bundle, input({ isDefault: true })) as FileBundle
    bundle = w.renderApply(bundle, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k', model: 'm' })) as FileBundle
    const cfg = TOML.parse(w.renderClear(bundle, 'p1')[P]!) as any
    expect(cfg.model_providers[pid1]).toBeUndefined()
    expect(cfg.profiles[pid1]).toBeUndefined()
    expect(cfg.model_providers[pid2]).toBeDefined()
    // 顶层默认曾指向 p1 → 一并清除
    expect(cfg.model_provider).toBeUndefined()
    expect(cfg.model).toBeUndefined()
  })

  it('renderClear 不动指向他档/用户的顶层默认', () => {
    const existing = 'model_provider = "openai"\n\n[model_providers.openai]\nname = "OpenAI"\n'
    const withHxg = w.renderApply({ [P]: existing }, input())
    const cfg = TOML.parse(w.renderClear(withHxg, 'p1')[P]!) as any
    expect(cfg.model_provider).toBe('openai') // 用户默认保留
    expect(cfg.model_providers.openai).toBeDefined()
  })

  it('renderClear 无号小管块（纯用户配置）→ 返回 {}（无变更，applier 据此跳过停-写-启）', () => {
    const userCfg = 'model = "gpt-5"\n\n[mcp_servers.foo]\ncommand = "x"\n'
    expect(w.renderClear({ [P]: userCfg }, 'p1')).toEqual({})
  })

  it('renderClear config 不存在 → 返回 {}', () => {
    expect(w.renderClear({ [P]: null }, 'p1')).toEqual({})
  })

  it('renderClear 确有本档块时仍正常移除（不被无变更短路误伤）', () => {
    const withHxg = w.renderApply({ [P]: null }, input()) as FileBundle
    const out = w.renderClear(withHxg, 'p1')
    expect(out[P]).toBeDefined() // 有东西可清 → 返回配置
    const cfg = TOML.parse(out[P]!) as any
    expect(cfg.model_providers?.[pid1]).toBeUndefined()
  })

  it('损坏 TOML → 抛 ClientConfigCorruptError', () => {
    expect(() => w.renderApply({ [P]: 'model_provider = ' }, input())).toThrow(ClientConfigCorruptError)
  })

  it('configFiles 含 config.toml + catalog + auth.json（三者均入快照）', () => {
    expect(w.configFiles()).toEqual([P, CAT, AUTH])
  })

  // ---- base_url 规范化（请求 = POST {base_url}/responses，无路径须补 /v1）----
  it('base_url 无路径 → 自动补 /v1；尾斜杠剔除；自带路径原样尊重', () => {
    expect(apply({ [P]: null }, input({ baseUrl: 'http://127.0.0.1:8080' })).model_providers[pid1].base_url).toBe('http://127.0.0.1:8080/v1')
    expect(apply({ [P]: null }, input({ baseUrl: 'http://127.0.0.1:8080/' })).model_providers[pid1].base_url).toBe('http://127.0.0.1:8080/v1')
    expect(apply({ [P]: null }, input({ baseUrl: 'https://gw.example.com/openai' })).model_providers[pid1].base_url).toBe('https://gw.example.com/openai')
    expect(apply({ [P]: null }, input({ baseUrl: 'https://t/v1' })).model_providers[pid1].base_url).toBe('https://t/v1')
  })

  // ---- auth.json「只补空、绝不覆盖」----
  it('auth.json 不存在/无任何凭证 → 补写 OPENAI_API_KEY=供应商 key（App 可进、API 登录方式）', () => {
    const b1 = w.renderApply({ [P]: null }, input())
    expect(JSON.parse(b1[AUTH]!).OPENAI_API_KEY).toBe('sk-hxg')
    const b2 = w.renderApply({ [P]: null, [AUTH]: '{"some_other": 1}' }, input())
    const a2 = JSON.parse(b2[AUTH]!)
    expect(a2.OPENAI_API_KEY).toBe('sk-hxg')
    expect(a2.some_other).toBe(1) // 其余键保留
  })

  it('auth.json 已有 ChatGPT tokens 或 OPENAI_API_KEY → 绝不触碰', () => {
    const withTokens = w.renderApply({ [P]: null, [AUTH]: '{"tokens":{"access_token":"x"}}' }, input())
    expect(withTokens[AUTH]).toBeUndefined()
    const withKey = w.renderApply({ [P]: null, [AUTH]: '{"OPENAI_API_KEY":"sk-user"}' }, input())
    expect(withKey[AUTH]).toBeUndefined()
  })

  it('auth.json 损坏或 apiKey 为空 → 不动 auth.json（不阻断 provider 注入）', () => {
    const corrupt = w.renderApply({ [P]: null, [AUTH]: '{broken' }, input())
    expect(corrupt[AUTH]).toBeUndefined()
    expect(corrupt[P]).toBeDefined() // provider 注入照常
    const emptyKey = w.renderApply({ [P]: null }, input({ apiKey: '' }))
    expect(emptyKey[AUTH]).toBeUndefined()
  })

  it('renderClear 不回收 auth.json 的 OPENAI_API_KEY（回收会把用户锁在 App 外）', () => {
    const bundle = w.renderApply({ [P]: null }, input())
    const cleared = w.renderClear({ ...bundle }, 'p1')
    expect(cleared[AUTH]).toBeUndefined()
  })

  // ---- L2「中转注入」：model_catalog_json ----
  it('settings.codexCatalogModels → 写 catalog 文件 + 顶层 model_catalog_json 指向它', () => {
    const bundle = w.renderApply(
      { [P]: null },
      input({
        isDefault: true,
        settings: {
          codexCatalogModels: [
            { id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', contextLength: 200000 },
            { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
          ],
        },
      }),
    )
    // config.toml 指向 catalog 文件
    const cfg = TOML.parse(bundle[P]!) as any
    expect(cfg.model_catalog_json).toBe(CAT)
    // catalog 文件被写入，含两个非原生模型 slug
    expect(bundle[CAT]).toBeDefined()
    const catalog = JSON.parse(bundle[CAT]!) as { models: Array<{ slug: string; priority: number }> }
    const slugs = catalog.models.map((m) => m.slug)
    expect(slugs).toContain('claude-sonnet-4.5')
    expect(slugs).toContain('deepseek-chat')
    // priority 必须是整数（Codex schema 要求 i32；曾因 1-i*0.01 写出 0.99 导致 CLI 解析失败）。
    for (const m of catalog.models) {
      expect(Number.isInteger(m.priority)).toBe(true)
    }
  })

  it('无 codexCatalogModels → 不写 catalog、不设 model_catalog_json', () => {
    const bundle = w.renderApply({ [P]: null }, input({ isDefault: true }))
    expect(bundle[CAT]).toBeUndefined()
    const cfg = TOML.parse(bundle[P]!) as any
    expect(cfg.model_catalog_json).toBeUndefined()
  })

  it('renderClear 清掉号小管管理的 model_catalog_json 指向', () => {
    const withCat = w.renderApply(
      { [P]: null },
      input({ isDefault: true, settings: { codexCatalogModels: [{ id: 'claude-sonnet-4.5' }] } }),
    )
    const cleared = w.renderClear(withCat, 'p1')
    const cfg = TOML.parse(cleared[P]!) as any
    expect(cfg.model_catalog_json).toBeUndefined()
  })

  it('wire_api 恒为 responses：存量档 settings.wireApi="chat" 也不得透传（chat 已被 Codex 移除，写入即整个 config 解析失败）', () => {
    const cfg = apply({ [P]: null }, input({ settings: { wireApi: 'chat' } }))
    expect(cfg.model_providers[pid1].wire_api).toBe('responses')
  })

  it('默认切到无模型档 → 清残留顶层 model(不留脏指针)', () => {
    const a1 = w.renderApply({ [P]: null }, input({ isDefault: true })) // p1 model=kiro
    const a2 = w.renderApply(a1, input({ profileId: 'p2', name: 'B', model: undefined, isDefault: true }))
    const cfg = TOML.parse(a2[P]!) as any
    expect(cfg.model_provider).toBe(pid2)
    expect(cfg.model).toBeUndefined() // 不残留 p1 的 kiro
  })
})
