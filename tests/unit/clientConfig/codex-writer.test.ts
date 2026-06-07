import { describe, it, expect } from 'vitest'
import TOML from '@iarna/toml'
import { CodexWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/codex-writer'
import { codexProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/codex-toml'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.codex/config.toml'
const w = new CodexWriter(P)
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
    expect(cfg.model_providers[pid1].base_url).toBe('http://127.0.0.1:8788')
    expect(cfg.model_providers[pid1].wire_api).toBe('responses')
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

  it('损坏 TOML → 抛 ClientConfigCorruptError', () => {
    expect(() => w.renderApply({ [P]: 'model_provider = ' }, input())).toThrow(ClientConfigCorruptError)
  })

  it('configFiles 仅含 config.toml（auth.json 从不修改）', () => {
    expect(w.configFiles()).toEqual([P])
  })

  it('settings.wireApi 覆盖默认 wire_api', () => {
    const cfg = apply({ [P]: null }, input({ settings: { wireApi: 'chat' } }))
    expect(cfg.model_providers[pid1].wire_api).toBe('chat')
  })

  it('默认切到无模型档 → 清残留顶层 model(不留脏指针)', () => {
    const a1 = w.renderApply({ [P]: null }, input({ isDefault: true })) // p1 model=kiro
    const a2 = w.renderApply(a1, input({ profileId: 'p2', name: 'B', model: undefined, isDefault: true }))
    const cfg = TOML.parse(a2[P]!) as any
    expect(cfg.model_provider).toBe(pid2)
    expect(cfg.model).toBeUndefined() // 不残留 p1 的 kiro
  })
})
