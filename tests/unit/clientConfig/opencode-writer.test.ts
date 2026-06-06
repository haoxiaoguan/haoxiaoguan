import { describe, it, expect } from 'vitest'
import { OpenCodeWriter, opencodeProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/writers/opencode-writer'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.config/opencode/opencode.json'
const w = new OpenCodeWriter(P)

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro', ...over }
}
const apply = (cur: FileBundle, inp = input()) => JSON.parse(w.renderApply(cur, inp)[P]!)

describe('OpenCodeWriter (additive)', () => {
  it('文件不存在 → 建 provider.hxg-p1 + $schema', () => {
    const cfg = apply({ [P]: null })
    const pid = opencodeProviderId('p1')
    expect(cfg.$schema).toBe('https://opencode.ai/config.json')
    expect(cfg.provider[pid].npm).toBe('@ai-sdk/openai-compatible')
    expect(cfg.provider[pid].name).toBe('本机反代')
    expect(cfg.provider[pid].options).toEqual({ baseURL: 'http://127.0.0.1:8788', apiKey: 'sk-hxg' })
    expect(cfg.provider[pid].models).toEqual({ kiro: { name: 'kiro' } })
  })

  it('isDefault → 写顶层 model = hxg-p1/kiro', () => {
    const cfg = apply({ [P]: null }, input({ isDefault: true }))
    expect(cfg.model).toBe(`${opencodeProviderId('p1')}/kiro`)
  })

  it('非默认 → 不写顶层 model', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.model).toBeUndefined()
  })

  it('保留用户其余 provider 与 mcp，并支持两档共存', () => {
    const existing = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: { mine: { npm: 'x', options: {}, models: {} } },
      mcp: { ctx7: { command: 'npx' } },
    })
    const after1 = w.renderApply({ [P]: existing }, input())
    const after2 = w.renderApply(after1, input({ profileId: 'p2', name: '第三方', baseUrl: 'http://t', apiKey: 'k2', model: 'gpt' }))
    const cfg = JSON.parse(after2[P]!)
    expect(Object.keys(cfg.provider).sort()).toEqual(['mine', opencodeProviderId('p1'), opencodeProviderId('p2')].sort())
    expect(cfg.mcp.ctx7.command).toBe('npx') // 用户其余配置不动
  })

  it('renderClear 只移除本档，保留他档/用户配置', () => {
    let bundle: FileBundle = { [P]: null }
    bundle = w.renderApply(bundle, input()) as FileBundle
    bundle = w.renderApply(bundle, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k', model: 'm' })) as FileBundle
    const cleared = JSON.parse(w.renderClear(bundle, 'p1')[P]!)
    expect(cleared.provider[opencodeProviderId('p1')]).toBeUndefined()
    expect(cleared.provider[opencodeProviderId('p2')]).toBeDefined()
  })

  it('renderClear 仅在默认指针指向本档时清 model', () => {
    const withDefault = w.renderApply({ [P]: null }, input({ isDefault: true }))
    const cleared = JSON.parse(w.renderClear(withDefault, 'p1')[P]!)
    expect(cleared.model).toBeUndefined()
    // 默认指向他档时不动
    const otherDefault = JSON.stringify({ provider: { [opencodeProviderId('p1')]: {} }, model: 'other/x' })
    const cleared2 = JSON.parse(w.renderClear({ [P]: otherDefault }, 'p1')[P]!)
    expect(cleared2.model).toBe('other/x')
  })

  it('损坏 JSON → 抛 ClientConfigCorruptError', () => {
    expect(() => w.renderApply({ [P]: '{ not json' }, input())).toThrow(ClientConfigCorruptError)
  })
})
