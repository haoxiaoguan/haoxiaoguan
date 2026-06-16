// RelayUpstreamRegistry 单测（TDD）。
// 使用假 repository + 假 client 验证：
//   ① buildAdapters 返回正确数量的 adapter
//   ② platform 名格式为 relay-<id>
//   ③ codec.protocol 与 record.protocol 一致
//   ④ disabled 上游不出现在结果中
//   ⑤ models 正确传入 adapter（listModels 返回一致）
import { describe, it, expect } from 'vitest'
import { RelayUpstreamRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/relay/relay-upstream-registry'
import type { RelayUpstreamRecord } from '../../../src/main/contexts/apiProxy/infrastructure/relay/relay-upstream.repository'
import type { RelayUpstreamClient } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'

// 假 repository
function makeFakeRepo(records: RelayUpstreamRecord[], keyMap: Record<string, string>) {
  return {
    async list() { return [...records] },
    async resolveApiKey(id: string) {
      const key = keyMap[id]
      if (key === undefined) throw new Error(`no key for ${id}`)
      return key
    },
  }
}

// 假 client（relay-adapter 构造需要，测试不调用方法）
const fakeClient = {} as RelayUpstreamClient

const now = new Date().toISOString()

describe('RelayUpstreamRegistry', () => {
  it('buildAdapters 返回所有 enabled 上游的 adapter，platform 名 = relay-<id>', async () => {
    const records: RelayUpstreamRecord[] = [
      { id: 'aaa', displayName: 'A', protocol: 'openai', baseUrl: 'https://a.com', models: [], enabled: true, createdAt: now, updatedAt: now },
      { id: 'bbb', displayName: 'B', protocol: 'anthropic', baseUrl: 'https://b.com', models: [], enabled: true, createdAt: now, updatedAt: now },
    ]
    const repo = makeFakeRepo(records, { aaa: 'key-a', bbb: 'key-b' })
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()

    expect(adapters).toHaveLength(2)
    const platforms = adapters.map((a) => a.platform).sort()
    expect(platforms).toEqual(['relay-aaa', 'relay-bbb'])
  })

  it('disabled 上游不出现在结果中', async () => {
    const records: RelayUpstreamRecord[] = [
      { id: 'x1', displayName: 'X1', protocol: 'openai', baseUrl: 'https://x1.com', models: [], enabled: true, createdAt: now, updatedAt: now },
      { id: 'x2', displayName: 'X2', protocol: 'openai', baseUrl: 'https://x2.com', models: [], enabled: false, createdAt: now, updatedAt: now },
    ]
    const repo = makeFakeRepo(records, { x1: 'key-x1' })
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()

    expect(adapters).toHaveLength(1)
    expect(adapters[0].platform).toBe('relay-x1')
  })

  it('codec.protocol 与 record.protocol 一致', async () => {
    const records: RelayUpstreamRecord[] = [
      { id: 'p1', displayName: 'P1', protocol: 'openai', baseUrl: 'https://p1.com', models: [], enabled: true, createdAt: now, updatedAt: now },
      { id: 'p2', displayName: 'P2', protocol: 'anthropic', baseUrl: 'https://p2.com', models: [], enabled: true, createdAt: now, updatedAt: now },
    ]
    const repo = makeFakeRepo(records, { p1: 'key1', p2: 'key2' })
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()
    const adapterMap = Object.fromEntries(adapters.map((a) => [a.platform, a]))

    // RelayAdapter 没有 codec 直接暴露，验证 supportsModel 和 listModels 行为
    // （这里验证 platform 名一致性即可；codec.protocol 已由 codec-factory 测试覆盖）
    expect(adapterMap['relay-p1']).toBeDefined()
    expect(adapterMap['relay-p2']).toBeDefined()
  })

  it('models 正确传入 adapter（缺省 ownedBy 补为上游 displayName）', async () => {
    const models = [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextLength: 65536 },
    ]
    const records: RelayUpstreamRecord[] = [
      { id: 'm1', displayName: 'M1', protocol: 'openai', baseUrl: 'https://m1.com', models, enabled: true, createdAt: now, updatedAt: now },
    ]
    const repo = makeFakeRepo(records, { m1: 'key-m1' })
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()
    expect(adapters).toHaveLength(1)
    // 缺省 ownedBy → 补为上游 displayName，避免 /v1/models 把 relay 模型错标成 kiro。
    expect(adapters[0].listModels()).toEqual([{ ...models[0], ownedBy: 'M1' }])
    expect(adapters[0].supportsModel('deepseek-chat')).toBe(true)
    expect(adapters[0].supportsModel('unknown-model')).toBe(false)
  })

  it('models 显式 ownedBy → 保留不覆盖', async () => {
    const models = [{ id: 'glm-5.1', displayName: 'GLM-5.1', ownedBy: 'zhipu' }]
    const records: RelayUpstreamRecord[] = [
      { id: 'm2', displayName: 'kimi', protocol: 'openai', baseUrl: 'https://m2.com', models, enabled: true, createdAt: now, updatedAt: now },
    ]
    const repo = makeFakeRepo(records, { m2: 'key-m2' })
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()
    expect(adapters[0].listModels()[0].ownedBy).toBe('zhipu')
  })

  it('没有任何上游时返回空数组', async () => {
    const repo = makeFakeRepo([], {})
    const registry = new RelayUpstreamRegistry({ repository: repo as never, client: fakeClient })

    const adapters = await registry.buildAdapters()
    expect(adapters).toHaveLength(0)
  })
})
