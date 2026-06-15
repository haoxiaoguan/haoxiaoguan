import { describe, it, expect, vi } from 'vitest'
import { RoutingLogService } from '../../../src/main/contexts/apiProxy/application/routing-log-service'
import type { MikroOrmRoutingLogRepository } from '../../../src/main/contexts/apiProxy/infrastructure/routing-log/mikro-orm-routing-log.repository'
import type { ProxyRequestRecord } from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'

function rec(seq: number, tsMs = 1_700_000_000_000): ProxyRequestRecord {
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
  }
}

/** 最小可控假仓储：记录调用，insertMany 返回 batch 最小 tsSec。 */
function makeFakeRepo() {
  const calls = {
    insertMany: [] as ProxyRequestRecord[][],
    rebuildSince: [] as number[],
    purge: [] as Array<[number, string]>,
    clearAll: 0,
  }
  const repo = {
    insertMany: vi.fn(async (records: ProxyRequestRecord[]) => {
      calls.insertMany.push(records)
      if (records.length === 0) return null
      return Math.min(...records.map((r) => Math.floor(r.tsMs / 1000)))
    }),
    rebuildRollupsSince: vi.fn(async (minTsSec: number) => {
      calls.rebuildSince.push(minTsSec)
    }),
    purge: vi.fn(async (detailCutoffSec: number, rollupCutoffDate: string) => {
      calls.purge.push([detailCutoffSec, rollupCutoffDate])
    }),
    clearAll: vi.fn(async () => {
      calls.clearAll += 1
    }),
    summary: vi.fn(async () => ({ requests: 42 }) as unknown),
    trend: vi.fn(async () => [{ date: 'x' }] as unknown),
    breakdown: vi.fn(async () => [{ key: 'kiro' }] as unknown),
    topErrors: vi.fn(async () => [{ message: 'boom' }] as unknown),
    recent: vi.fn(async () => [{ seq: 1 }] as unknown),
  }
  return { repo: repo as unknown as MikroOrmRoutingLogRepository, raw: repo, calls }
}

describe('RoutingLogService', () => {
  it('enqueue + flush：批量落库 + 增量 rollup + 清空缓冲', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingLogService(repo)
    svc.enqueue(rec(1, 1_700_000_000_000))
    svc.enqueue(rec(2, 1_700_000_005_000))
    expect(svc.pendingCount()).toBe(2)

    await svc.flush()
    expect(calls.insertMany).toHaveLength(1)
    expect(calls.insertMany[0].map((r) => r.seq)).toEqual([1, 2])
    expect(calls.rebuildSince[0]).toBe(1_700_000_000) // 最小 tsSec
    expect(svc.pendingCount()).toBe(0)
  })

  it('空缓冲 flush 不调 insertMany', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingLogService(repo)
    await svc.flush()
    expect(calls.insertMany).toHaveLength(0)
  })

  it('bufferCap：超上限丢最旧', async () => {
    const { repo } = makeFakeRepo()
    const svc = new RoutingLogService(repo, { bufferCap: 100 })
    for (let i = 0; i < 250; i++) svc.enqueue(rec(i))
    expect(svc.pendingCount()).toBe(100)
  })

  it('重入保护：flush 进行中再次 flush 不重复抽干缓冲', async () => {
    const { repo, raw, calls } = makeFakeRepo()
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => {
      release = res
    })
    // 让首个 insertMany 卡住，模拟落库进行中。
    raw.insertMany.mockImplementationOnce(async (records: ProxyRequestRecord[]) => {
      calls.insertMany.push(records)
      await gate
      return Math.floor(records[0].tsMs / 1000)
    })

    const svc = new RoutingLogService(repo)
    svc.enqueue(rec(1))
    const p1 = svc.flush() // 抽干 [1]，卡在 insertMany
    svc.enqueue(rec(2)) // 入队第二批
    await svc.flush() // flushing=true → 立即返回，不抽干
    expect(svc.pendingCount()).toBe(1) // [2] 仍在缓冲
    expect(calls.insertMany).toHaveLength(1)

    release()
    await p1
    await svc.flush() // 现在抽干 [2]
    expect(calls.insertMany).toHaveLength(2)
    expect(calls.insertMany[1].map((r) => r.seq)).toEqual([2])
  })

  it('保留期清理按天节流：同日仅一次，跨日再次', async () => {
    const { repo, calls } = makeFakeRepo()
    let now = new Date('2026-06-15T10:00:00Z').getTime()
    const svc = new RoutingLogService(repo, { clock: () => now })

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

  it('查询前先 flush 再委托仓储', async () => {
    const { repo, calls, raw } = makeFakeRepo()
    const svc = new RoutingLogService(repo)
    svc.enqueue(rec(1))
    const s = (await svc.summary({ startSec: 0, endSec: 1 })) as { requests: number }
    expect(calls.insertMany).toHaveLength(1) // 读前已 flush
    expect(raw.summary).toHaveBeenCalledOnce()
    expect(s.requests).toBe(42)
  })

  it('clear：清缓冲 + 清两表', async () => {
    const { repo, calls } = makeFakeRepo()
    const svc = new RoutingLogService(repo)
    svc.enqueue(rec(1))
    await svc.clear()
    expect(svc.pendingCount()).toBe(0)
    expect(calls.clearAll).toBe(1)
  })
})
