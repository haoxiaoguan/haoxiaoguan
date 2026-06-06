import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { HermesWriter, hermesProviderName } from '../../../src/main/contexts/clientConfig/infrastructure/writers/hermes-writer'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.hermes/config.yaml'
const w = new HermesWriter(P)
const n1 = hermesProviderName('p1')
const n2 = hermesProviderName('p2')

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro', ...over }
}
const apply = (cur: FileBundle, inp = input()) => yaml.load(w.renderApply(cur, inp)[P]!) as any
const find = (cfg: any, name: string) => cfg.custom_providers.find((e: any) => e.name === name)

describe('HermesWriter (additive, YAML)', () => {
  it('文件不存在 → custom_providers[0] snake_case 项', () => {
    const cfg = apply({ [P]: null })
    const e = find(cfg, n1)
    expect(e.base_url).toBe('http://127.0.0.1:8788')
    expect(e.api_key).toBe('sk-hxg')
    expect(e.api_mode).toBe('chat_completions')
    expect(e.model).toBe('kiro')
    expect(e.models).toEqual({ kiro: {} })
  })

  it('isDefault → 顶层 model.{default,provider}', () => {
    const cfg = apply({ [P]: null }, input({ isDefault: true }))
    expect(cfg.model.default).toBe('kiro')
    expect(cfg.model.provider).toBe(n1)
  })

  it('非默认 → 不写顶层 model 段', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.model).toBeUndefined()
  })

  it('两档共存 + 保留用户已有 provider', () => {
    const existing = yaml.dump({ custom_providers: [{ name: 'mine', base_url: 'http://x', api_key: 'k', api_mode: 'chat_completions' }] })
    const a1 = w.renderApply({ [P]: existing }, input())
    const a2 = w.renderApply(a1, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k2', model: 'm' }))
    const cfg = yaml.load(a2[P]!) as any
    expect(cfg.custom_providers.map((e: any) => e.name).sort()).toEqual(['mine', n1, n2].sort())
  })

  it('同 name 二次 apply = upsert（不重复)', () => {
    const a1 = w.renderApply({ [P]: null }, input())
    const a2 = w.renderApply(a1, input({ baseUrl: 'http://changed' }))
    const cfg = yaml.load(a2[P]!) as any
    expect(cfg.custom_providers.filter((e: any) => e.name === n1).length).toBe(1)
    expect(find(cfg, n1).base_url).toBe('http://changed')
  })

  it('renderClear 只移除本档,保留他档；默认指向本档则清', () => {
    let b: FileBundle = { [P]: null }
    b = w.renderApply(b, input({ isDefault: true })) as FileBundle
    b = w.renderApply(b, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k', model: 'm' })) as FileBundle
    const cfg = yaml.load(w.renderClear(b, 'p1')[P]!) as any
    expect(find(cfg, n1)).toBeUndefined()
    expect(find(cfg, n2)).toBeDefined()
    expect(cfg.model?.provider).toBeUndefined()
  })

  it('renderClear 不动指向他档的默认', () => {
    const existing = yaml.dump({ custom_providers: [{ name: n1 }], model: { provider: 'other', default: 'x' } })
    const cfg = yaml.load(w.renderClear({ [P]: existing }, 'p1')[P]!) as any
    expect(cfg.model.provider).toBe('other')
  })

  it('损坏 YAML → 抛 ClientConfigCorruptError', () => {
    expect(() => w.renderApply({ [P]: 'foo: [unclosed' }, input())).toThrow(ClientConfigCorruptError)
  })
})
