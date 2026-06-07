import { describe, it, expect } from 'vitest'
import { OpenClawWriter, openClawProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/writers/openclaw-writer'
import { ClientConfigCorruptError, type ApplyInput, type FileBundle } from '../../../src/main/contexts/clientConfig/domain/client-writer'

const P = '/home/u/.openclaw/openclaw.json'
const w = new OpenClawWriter(P)
const pid1 = openClawProviderId('p1')
const pid2 = openClawProviderId('p2')

function input(over: Partial<ApplyInput> = {}): ApplyInput {
  return { profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro', ...over }
}
const apply = (cur: FileBundle, inp = input()) => JSON.parse(w.renderApply(cur, inp)[P]!)

describe('OpenClawWriter (additive)', () => {
  it('文件不存在 → models.providers.<hxg> + mode=merge', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.models.mode).toBe('merge')
    expect(cfg.models.providers[pid1].baseUrl).toBe('http://127.0.0.1:8788')
    expect(cfg.models.providers[pid1].apiKey).toBe('sk-hxg')
    expect(cfg.models.providers[pid1].api).toBe('openai-completions')
    expect(cfg.models.providers[pid1].models).toEqual([{ id: 'kiro', name: 'kiro' }])
  })

  it('isDefault → agents.defaults.model.primary = hxg/kiro', () => {
    const cfg = apply({ [P]: null }, input({ isDefault: true }))
    expect(cfg.agents.defaults.model.primary).toBe(`${pid1}/kiro`)
  })

  it('非默认 → 不写 agents.defaults.model', () => {
    const cfg = apply({ [P]: null })
    expect(cfg.agents?.defaults?.model).toBeUndefined()
  })

  it('两档共存 + 保留用户其余 provider/agents', () => {
    const existing = JSON.stringify({
      models: { mode: 'merge', providers: { mine: { baseUrl: 'http://x', apiKey: 'k', api: 'openai-completions', models: [] } } },
      agents: { defaults: { timeout: 30 } },
    })
    const a1 = w.renderApply({ [P]: existing }, input())
    const a2 = w.renderApply(a1, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k2', model: 'm' }))
    const cfg = JSON.parse(a2[P]!)
    expect(Object.keys(cfg.models.providers).sort()).toEqual(['mine', pid1, pid2].sort())
    expect(cfg.agents.defaults.timeout).toBe(30) // 用户其余 agents 配置保留
  })

  it('renderClear 只移除本档,保留他档', () => {
    let b: FileBundle = { [P]: null }
    b = w.renderApply(b, input({ isDefault: true })) as FileBundle
    b = w.renderApply(b, input({ profileId: 'p2', name: 'B', baseUrl: 'http://b', apiKey: 'k', model: 'm' })) as FileBundle
    const cfg = JSON.parse(w.renderClear(b, 'p1')[P]!)
    expect(cfg.models.providers[pid1]).toBeUndefined()
    expect(cfg.models.providers[pid2]).toBeDefined()
    expect(cfg.agents?.defaults?.model).toBeUndefined() // 默认曾指向 p1 → 清除
  })

  it('renderClear 不动指向他档的默认指针', () => {
    const existing = JSON.stringify({
      models: { mode: 'merge', providers: { [pid1]: { baseUrl: 'x', apiKey: 'k', api: 'openai-completions', models: [] } } },
      agents: { defaults: { model: { primary: 'other/x' } } },
    })
    const cfg = JSON.parse(w.renderClear({ [P]: existing }, 'p1')[P]!)
    expect(cfg.agents.defaults.model.primary).toBe('other/x')
  })

  it('损坏 JSON → 抛 ClientConfigCorruptError', () => {
    expect(() => w.renderApply({ [P]: '{ bad' }, input())).toThrow(ClientConfigCorruptError)
  })

  it('models.providers 非对象(用户写成数组) → 抛 ClientConfigCorruptError 拒写', () => {
    const bad = JSON.stringify({ models: { mode: 'merge', providers: ['x'] } })
    expect(() => w.renderApply({ [P]: bad }, input())).toThrow(ClientConfigCorruptError)
  })

  it('models 非对象 → 抛 ClientConfigCorruptError 拒写', () => {
    const bad = JSON.stringify({ models: 'oops' })
    expect(() => w.renderApply({ [P]: bad }, input())).toThrow(ClientConfigCorruptError)
  })

  it('settings.api 覆盖默认协议', () => {
    const cfg = apply({ [P]: null }, input({ settings: { api: 'anthropic-messages' } }))
    expect(cfg.models.providers[pid1].api).toBe('anthropic-messages')
  })
})
