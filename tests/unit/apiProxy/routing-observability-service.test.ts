import { describe, it, expect, vi } from 'vitest'
import { RoutingObservabilityService } from '../../../src/main/contexts/apiProxy/application/routing-observability-service'
import type { MikroOrmRoutingObservabilityRepository } from '../../../src/main/contexts/apiProxy/infrastructure/observability/mikro-orm-routing-observability.repository'
import type { ProxyRequestRecord } from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'
import type { RoutingEvent } from '../../../src/main/contexts/apiProxy/domain/observability/routing-event'

function rec(seq: number, tsMs = 1_700_000_000_000, over: Partial<ProxyRequestRecord> = {}): ProxyRequestRecord {
  return {
    seq,
    tsMs,
    method: 'POST',
    path: '/v1/messages',
    format: 'anthropic',
    action: 'messages',
    stream: false,
    status: 200,
    ok: true,
    durationMs: 50,
    attempts: 1,
    ...over,
  }
}

/** 假写入仓储：记录 ingestBatch/purge/clearAll 调用。 */
function makeFakeRepo() {
  const calls = {
    ingest: [] as RoutingEvent[][],
    purge: [] as Array<[number, string]>,
    clearAll: 0,
  }
  const repo = {
    ingestBatch: vi.fn(async (events: RoutingEvent[]) => {
      calls.ingest.push(events)
    }),
    purge: vi.fn(async (detailCutoffSec: number, rollupCutoffDate: string) => {
      calls.purge.push([detailCutoffSec, rollupCutoffDate])
    }),
    clearAll: vi.fn(async () => {
      calls.clearAll += 1
    }),
  }
  return { repo: repo as unknown as MikroOrmRoutingObservabilityRepository, raw: repo, calls }
}

describe('RoutingObservabilityService', () => {
  it('enqueue + flush：映射为 RoutingEvent → ingestBatch + 清空缓冲', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingObservabilityService(repo)
    svc.enqueue(rec(1))
    svc.enqueue(rec(2, 1_700_000_005_000, { ok: false, status: 429 }))
    expect(svc.pendingCount()).toBe(2)

    await svc.flush()
    expect(calls.ingest).toHaveLength(1)
    expect(calls.ingest[0].map((e) => e.seq)).toEqual([1, 2])
    // 过渡期映射：errorKind 由 status/ok 推导。
    expect(calls.ingest[0][0].errorKind).toBe('none')
    expect(calls.ingest[0][1].errorKind).toBe('ratelimit')
    expect(svc.pendingCount()).toBe(0)
  })

  it('空缓冲 flush 不调 ingestBatch', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingObservabilityService(repo)
    await svc.flush()
    expect(calls.ingest).toHaveLength(0)
  })

  it('bufferCap：超上限丢最旧', async () => {
    const { repo } = makeFakeRepo()
    const svc = new RoutingObservabilityService(repo, { bufferCap: 100 })
    for (let i = 0; i < 250; i++) svc.enqueue(rec(i))
    expect(svc.pendingCount()).toBe(100)
  })

  it('重入保护：flush 进行中再次 flush 不重复抽干缓冲', async () => {
    const { repo, raw, calls } = makeFakeRepo()
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => {
      release = res
    })
    raw.ingestBatch.mockImplementationOnce(async (events: RoutingEvent[]) => {
      calls.ingest.push(events)
      await gate
    })

    const svc = new RoutingObservabilityService(repo)
    svc.enqueue(rec(1))
    const p1 = svc.flush() // 抽干 [1]，卡在 ingestBatch
    svc.enqueue(rec(2))
    await svc.flush() // flushing=true → 立即返回，不抽干
    expect(svc.pendingCount()).toBe(1)
    expect(calls.ingest).toHaveLength(1)

    release()
    await p1
    await svc.flush()
    expect(calls.ingest).toHaveLength(2)
    expect(calls.ingest[1].map((e) => e.seq)).toEqual([2])
  })

  it('保留期清理按天节流：同日一次，跨日再次', async () => {
    const { repo, calls } = makeFakeRepo()
    let now = new Date('2026-06-15T10:00:00Z').getTime()
    const svc = new RoutingObservabilityService(repo, { clock: () => now })

    svc.enqueue(rec(1, now))
    await svc.flush()
    expect(calls.purge).toHaveLength(1)

    svc.enqueue(rec(2, now))
    await svc.flush() // 同日
    expect(calls.purge).toHaveLength(1)

    now = new Date('2026-06-16T10:00:00Z').getTime()
    svc.enqueue(rec(3, now))
    await svc.flush() // 跨日
    expect(calls.purge).toHaveLength(2)
  })

  it('clear：清缓冲 + 清全部表', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingObservabilityService(repo)
    svc.enqueue(rec(1))
    await svc.clear()
    expect(svc.pendingCount()).toBe(0)
    expect(calls.clearAll).toBe(1)
  })
})
