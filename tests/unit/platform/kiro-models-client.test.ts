import { describe, it, expect, vi } from 'vitest'
import {
  fetchAvailableModels,
  ModelListCache,
} from '../../../src/main/platform/net/kiro/kiro-identity-client'
import type { FetchImpl } from '../../../src/main/platform/net/kiro/kiro-identity-client'

// ---- fake fetch helpers ----

function fakeFetch(pages: Array<{ status: number; body: unknown }>): {
  impl: FetchImpl
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let idx = 0
  const impl: FetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const page = pages[idx] ?? pages[pages.length - 1]
    idx++
    const text = typeof page.body === 'string' ? page.body : JSON.stringify(page.body)
    return {
      ok: page.status >= 200 && page.status < 300,
      status: page.status,
      text: async () => text,
    } as Response
  }
  return { impl, calls }
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>
}

// ---- fetchAvailableModels ----

describe('fetchAvailableModels', () => {
  it('单页：解析返回模型列表', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          models: [
            { modelId: 'CLAUDE_SONNET_4_20250514_V1_0', modelName: 'Claude Sonnet 4' },
            { modelId: 'CLAUDE_HAIKU_3_20240307_V1_0', modelName: 'Claude Haiku 3', rateMultiplier: 0.5 },
          ],
        },
      },
    ])
    const result = await fetchAvailableModels(
      { accessToken: 'tok', region: 'us-east-1', machineId: 'mid-1' },
      { fetchImpl: f.impl },
    )
    expect(result).toHaveLength(2)
    expect(result[0].modelId).toBe('CLAUDE_SONNET_4_20250514_V1_0')
    expect(result[0].modelName).toBe('Claude Sonnet 4')
    expect(result[1].modelId).toBe('CLAUDE_HAIKU_3_20240307_V1_0')
    expect(result[1].rateMultiplier).toBe(0.5)
    expect(f.calls).toHaveLength(1)
  })

  it('多页 nextToken：聚合所有 models', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          models: [{ modelId: 'MODEL_A' }],
          nextToken: 'tok-page-2',
        },
      },
      {
        status: 200,
        body: {
          models: [{ modelId: 'MODEL_B' }, { modelId: 'MODEL_C' }],
          // no nextToken → stops
        },
      },
    ])
    const result = await fetchAvailableModels(
      { accessToken: 'bearer', region: 'us-east-1', machineId: 'mid-2' },
      { fetchImpl: f.impl },
    )
    expect(result.map((m) => m.modelId)).toEqual(['MODEL_A', 'MODEL_B', 'MODEL_C'])
    expect(f.calls).toHaveLength(2)
    // 第二页 URL 含 nextToken
    expect(f.calls[1].url).toContain('nextToken=tok-page-2')
  })

  it('headers 含 x-amzn-codewhisperer-optout + codewhispererstreaming UA + Bearer', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [] } }])
    await fetchAvailableModels(
      { accessToken: 'my-token', region: 'us-east-1', machineId: 'machine-xyz' },
      { fetchImpl: f.impl },
    )
    const h = headersOf(f.calls[0].init)
    expect(h['Authorization']).toBe('Bearer my-token')
    expect(h['x-amzn-codewhisperer-optout']).toBe('true')
    expect(h['user-agent']).toContain('api/codewhispererstreaming#')
    expect(h['user-agent']).toContain('KiroIDE-')
    expect(h['user-agent']).toContain('machine-xyz')
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Accept']).toBe('application/json')
  })

  it('URL 含 origin=AI_EDITOR + maxResults=50 + profileArn（若传）', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [] } }])
    const arn = 'arn:aws:codewhisperer:us-east-1:123:profile/ABC'
    await fetchAvailableModels(
      { accessToken: 'tok', region: 'us-east-1', profileArn: arn, machineId: 'mid' },
      { fetchImpl: f.impl },
    )
    const url = f.calls[0].url
    expect(url).toContain('origin=AI_EDITOR')
    expect(url).toContain('maxResults=50')
    expect(url).toContain('profileArn=')
    expect(decodeURIComponent(url)).toContain(arn)
  })

  it('profileArn 缺省时 URL 不含 profileArn', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [] } }])
    await fetchAvailableModels(
      { accessToken: 'tok', region: 'us-east-1', machineId: 'mid' },
      { fetchImpl: f.impl },
    )
    expect(f.calls[0].url).not.toContain('profileArn')
  })

  it('上游 401 → 返回空数组，不抛', async () => {
    const f = fakeFetch([{ status: 401, body: { message: 'Unauthorized' } }])
    const result = await fetchAvailableModels(
      { accessToken: 'bad-tok', region: 'us-east-1', machineId: 'mid' },
      { fetchImpl: f.impl },
    )
    expect(result).toEqual([])
  })

  it('上游 403 → 返回空数组，不抛', async () => {
    const f = fakeFetch([{ status: 403, body: 'Forbidden' }])
    const result = await fetchAvailableModels(
      { accessToken: 'tok', region: 'eu-central-1', machineId: 'mid' },
      { fetchImpl: f.impl },
    )
    expect(result).toEqual([])
  })

  it('网络异常 → 返回空数组，不抛', async () => {
    const impl: FetchImpl = async () => {
      throw new Error('network error')
    }
    const result = await fetchAvailableModels(
      { accessToken: 'tok', region: 'us-east-1', machineId: 'mid' },
      { fetchImpl: impl },
    )
    expect(result).toEqual([])
  })

  it('region → 正确的 q.<region>.amazonaws.com 端点', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [] } }])
    await fetchAvailableModels(
      { accessToken: 'tok', region: 'eu-central-1', machineId: 'mid' },
      { fetchImpl: f.impl },
    )
    expect(f.calls[0].url).toContain('q.eu-central-1.amazonaws.com')
  })
})

// ---- ModelListCache ----

describe('ModelListCache', () => {
  it('首次 getOrFetch 调用 fetcher 并缓存结果', async () => {
    const cache = new ModelListCache({ ttlMs: 5000, clock: () => 0 })
    const fetcher = vi.fn().mockResolvedValue([{ modelId: 'MODEL_A' }])
    const result = await cache.getOrFetch('key1', fetcher)
    expect(result).toEqual([{ modelId: 'MODEL_A' }])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('TTL 内第二次调用不重复 fetch（命中缓存）', async () => {
    let now = 0
    const cache = new ModelListCache({ ttlMs: 300_000, clock: () => now })
    const fetcher = vi.fn().mockResolvedValue([{ modelId: 'MODEL_B' }])

    await cache.getOrFetch('key2', fetcher)
    now = 100_000 // 100s 内，未过期
    const result = await cache.getOrFetch('key2', fetcher)

    expect(result).toEqual([{ modelId: 'MODEL_B' }])
    expect(fetcher).toHaveBeenCalledTimes(1) // 未重新 fetch
  })

  it('TTL 过期后重新 fetch', async () => {
    let now = 0
    const cache = new ModelListCache({ ttlMs: 300_000, clock: () => now })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ modelId: 'STALE' }])
      .mockResolvedValueOnce([{ modelId: 'FRESH' }])

    await cache.getOrFetch('key3', fetcher)
    now = 300_001 // 刚好过期
    const result = await cache.getOrFetch('key3', fetcher)

    expect(result).toEqual([{ modelId: 'FRESH' }])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('invalidate 使缓存失效，下次重新 fetch', async () => {
    const now = 0
    const cache = new ModelListCache({ ttlMs: 300_000, clock: () => now })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ modelId: 'OLD' }])
      .mockResolvedValueOnce([{ modelId: 'NEW' }])

    await cache.getOrFetch('key4', fetcher)
    cache.invalidate('key4')
    const result = await cache.getOrFetch('key4', fetcher)

    expect(result).toEqual([{ modelId: 'NEW' }])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('不同 key 互不干扰', async () => {
    const cache = new ModelListCache({ ttlMs: 300_000, clock: () => 0 })
    const fetcherA = vi.fn().mockResolvedValue([{ modelId: 'A' }])
    const fetcherB = vi.fn().mockResolvedValue([{ modelId: 'B' }])

    const a = await cache.getOrFetch('keyA', fetcherA)
    const b = await cache.getOrFetch('keyB', fetcherB)

    expect(a[0].modelId).toBe('A')
    expect(b[0].modelId).toBe('B')
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
  })

  it('ModelListCache.makeKey 格式：accountId:region:profileArn', () => {
    expect(ModelListCache.makeKey('acc-1', 'us-east-1', 'arn:aws:xyz')).toBe('acc-1:us-east-1:arn:aws:xyz')
    expect(ModelListCache.makeKey('acc-2', 'eu-central-1', undefined)).toBe('acc-2:eu-central-1:')
  })

  it('默认 TTL 为 5 分钟（300_000 ms）', async () => {
    let now = 0
    const cache = new ModelListCache({ clock: () => now }) // 不传 ttlMs，用默认
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ modelId: 'M1' }])
      .mockResolvedValueOnce([{ modelId: 'M2' }])

    await cache.getOrFetch('k', fetcher)
    now = 299_999 // 未过期
    await cache.getOrFetch('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    now = 300_000 // 刚好过期（>= ttlMs）
    await cache.getOrFetch('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
