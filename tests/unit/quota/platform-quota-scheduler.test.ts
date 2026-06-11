import { describe, it, expect, vi } from 'vitest'
import { PlatformQuotaScheduler } from '../../../src/main/contexts/quota/application/platform-quota-scheduler'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'

// Minimal Account stand-in: the scheduler only reads `.id`.
function acc(id: string) {
  return { id } as { id: string }
}

// A controllable clock.
function clock(startMs = 0) {
  let t = startMs
  return { now: () => t, advanceMinutes: (m: number) => { t += m * 60_000 } }
}

interface RepoState {
  byPlatform: Partial<Record<PlatformId, Array<{ id: string }>>>
  activeByPlatform: Partial<Record<PlatformId, { id: string } | null>>
}

function fakeRepo(state: RepoState) {
  return {
    findByPlatform: async (p: PlatformId) => (state.byPlatform[p] ?? []) as never,
    findActiveByPlatform: async (p: PlatformId) => (state.activeByPlatform[p] ?? null) as never,
    // unused by the scheduler
    findById: async () => null as never,
    findByTags: async () => [] as never,
    save: async () => {},
    delete: async () => {},
    existsByIdentifier: async () => false,
  }
}

function fakeSettings(
  active: Record<string, number>,
  batch: Record<string, number>,
  concurrency = 3,
) {
  return {
    getActiveRefreshIntervals: () => active,
    getPlatformRefreshIntervals: () => batch,
    getQuotaRefreshConcurrency: () => concurrency,
  }
}

describe('PlatformQuotaScheduler', () => {
  it('runs a batch sweep over every account when the platform interval elapses', async () => {
    const c = clock()
    const refreshed: string[] = []
    const repo = fakeRepo({ byPlatform: { kiro: [acc('a'), acc('b')] }, activeByPlatform: {} })
    const quota = { refreshQuota: async (id: string) => { refreshed.push(id) } }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )

    // Seeded at now=0; advancing past the 10-min interval makes the batch due.
    c.advanceMinutes(10)
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['a', 'b'])
  })

  it('does NOT batch-sweep when the platform interval is 0 (disabled)', async () => {
    const c = clock()
    const refreshed: string[] = []
    const repo = fakeRepo({ byPlatform: { kiro: [acc('a')] }, activeByPlatform: { kiro: acc('z') } })
    const quota = { refreshQuota: async (id: string) => { refreshed.push(id) } }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({ kiro: 5 }, { kiro: 0 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    c.advanceMinutes(5)
    await sched.tickOnce()
    // Only the active account refreshed, never the whole-platform sweep.
    expect(refreshed).toEqual(['z'])
  })

  it('refreshes only the active account on the active cadence', async () => {
    const c = clock()
    const refreshed: string[] = []
    const repo = fakeRepo({ byPlatform: { kiro: [acc('a'), acc('b')] }, activeByPlatform: { kiro: acc('a') } })
    const quota = { refreshQuota: async (id: string) => { refreshed.push(id) } }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({ kiro: 5 }, { kiro: 0 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    // Before the 5-min active interval: nothing.
    c.advanceMinutes(4)
    await sched.tickOnce()
    expect(refreshed).toEqual([])
    // After: only the active account.
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed).toEqual(['a'])
  })

  it('isolates a single account failure during a batch sweep', async () => {
    const c = clock()
    const refreshed: string[] = []
    const repo = fakeRepo({ byPlatform: { kiro: [acc('good1'), acc('bad'), acc('good2')] }, activeByPlatform: {} })
    const quota = {
      refreshQuota: async (id: string) => {
        if (id === 'bad') throw new Error('boom')
        refreshed.push(id)
      },
    }
    const reported: string[] = []
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      (ids) => reported.push(...ids),
      c.now,
      60_000,
      ['kiro'],
    )
    c.advanceMinutes(10)
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['good1', 'good2'])
    expect(reported.sort()).toEqual(['good1', 'good2']) // failed account not reported
  })

  it('guards against reentrant ticks', async () => {
    const c = clock()
    let inFlight = 0
    let maxConcurrent = 0
    const repo = fakeRepo({ byPlatform: { kiro: [acc('a')] }, activeByPlatform: {} })
    const quota = {
      refreshQuota: async () => {
        inFlight += 1
        maxConcurrent = Math.max(maxConcurrent, inFlight)
        await Promise.resolve()
        inFlight -= 1
      },
    }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    c.advanceMinutes(10)
    // Fire two ticks concurrently; the guard should let only one body run.
    await Promise.all([sched.tickOnce(), sched.tickOnce()])
    expect(maxConcurrent).toBe(1)
  })

  it('batch-sweeps an unconfigured platform on the 10-min default (ON by default)', async () => {
    const c = clock()
    const refreshed: string[] = []
    const repo = fakeRepo({ byPlatform: { kiro: [acc('a'), acc('b')] }, activeByPlatform: {} })
    const quota = { refreshQuota: async (id: string) => { refreshed.push(id) } }
    // No platform interval configured for kiro → falls back to the 10-min default.
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, {}),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    c.advanceMinutes(9)
    await sched.tickOnce()
    expect(refreshed).toEqual([]) // not yet due at 9 min
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['a', 'b']) // due at 10 min, swept whole platform
  })

  it('bounds batch-sweep parallelism by the concurrency setting', async () => {
    const c = clock()
    let inFlight = 0
    let maxConcurrent = 0
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => { release = r })
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a'), acc('b'), acc('c'), acc('d'), acc('e')] },
      activeByPlatform: {},
    })
    const quota = {
      refreshQuota: async () => {
        inFlight += 1
        maxConcurrent = Math.max(maxConcurrent, inFlight)
        await gate // hold all in-flight tasks until released
        inFlight -= 1
      },
    }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }, 2), // concurrency = 2
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    c.advanceMinutes(10)
    const tick = sched.tickOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(maxConcurrent).toBe(2) // never more than 2 concurrent despite 5 accounts
    release?.()
    await tick
    expect(maxConcurrent).toBe(2)
  })
})

describe('PlatformQuotaScheduler — seedFromStore（重启播种）', () => {
  // 时间轴均以 t=60min 启动调度器，模拟"app 重启"时刻。
  const T0 = 60 * 60_000

  function quotaWithStore(fetchedAt: Record<string, number | null>, refreshed: string[]) {
    return {
      refreshQuota: async (id: string) => {
        refreshed.push(id)
      },
      getQuotaFetchedAt: async (id: string) => {
        const ms = fetchedAt[id]
        return ms === undefined || ms === null ? null : new Date(ms)
      },
    }
  }

  it('过期平台第一个 tick 即补扫（非活跃账号 47 分钟没刷过 → 立即批量）', async () => {
    const c = clock(T0)
    const refreshed: string[] = []
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a'), acc('b')] },
      activeByPlatform: { kiro: acc('a') },
    })
    // 活跃 a 2 分钟前刷过；非活跃 b 47 分钟前 → lastBatchAt 播种到 13min。
    const quota = quotaWithStore({ a: 58 * 60_000, b: 13 * 60_000 }, refreshed)
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    await sched.seedFromStore()
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['a', 'b'])
  })

  it('数据新鲜则不提前触发，按持久化时刻续走节奏', async () => {
    const c = clock(T0)
    const refreshed: string[] = []
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a'), acc('b')] },
      activeByPlatform: { kiro: acc('a') },
    })
    // 两个账号都 2 分钟前刷过（58min）→ 批量应在 68min 到期，而非重启后再等满 10 分钟（70min）。
    const quota = quotaWithStore({ a: 58 * 60_000, b: 58 * 60_000 }, refreshed)
    const sched = new PlatformQuotaScheduler(
      fakeSettings({ kiro: 30 }, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    await sched.seedFromStore()
    c.advanceMinutes(7) // 67min：未到期
    await sched.tickOnce()
    expect(refreshed).toEqual([])
    c.advanceMinutes(1) // 68min：到期（58+10）
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['a', 'b'])
  })

  it('活跃账号计时独立播种：活跃过期只刷活跃，不触发批量', async () => {
    const c = clock(T0)
    const refreshed: string[] = []
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a'), acc('b')] },
      activeByPlatform: { kiro: acc('a') },
    })
    // 活跃 a 6 分钟前（默认 5 分钟间隔 → 已到期）；非活跃 b 1 分钟前（批量未到期）。
    const quota = quotaWithStore({ a: 54 * 60_000, b: 59 * 60_000 }, refreshed)
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    await sched.seedFromStore()
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed).toEqual(['a'])
  })

  it('quota 未实现 getQuotaFetchedAt 时保持构造播种（行为不变）', async () => {
    const c = clock(T0)
    const refreshed: string[] = []
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a')] },
      activeByPlatform: {},
    })
    const quota = { refreshQuota: async (id: string) => { refreshed.push(id) } }
    const sched = new PlatformQuotaScheduler(
      fakeSettings({}, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    await sched.seedFromStore()
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed).toEqual([]) // 仍需等满 10 分钟
  })

  it('未来时间戳被钳制到当前时刻（脏数据防御）', async () => {
    const c = clock(T0)
    const refreshed: string[] = []
    const repo = fakeRepo({
      byPlatform: { kiro: [acc('a'), acc('b')] },
      activeByPlatform: { kiro: acc('a') },
    })
    const quota = quotaWithStore({ a: 999 * 60_000, b: 999 * 60_000 }, refreshed)
    const sched = new PlatformQuotaScheduler(
      // 活跃间隔调大到 30，隔离批量路径的钳制断言
      fakeSettings({ kiro: 30 }, { kiro: 10 }),
      repo as never,
      quota,
      undefined,
      c.now,
      60_000,
      ['kiro'],
    )
    await sched.seedFromStore()
    c.advanceMinutes(9)
    await sched.tickOnce()
    expect(refreshed).toEqual([]) // 钳到 60min 起算
    c.advanceMinutes(1)
    await sched.tickOnce()
    expect(refreshed.sort()).toEqual(['a', 'b'])
  })
})

describe('PlatformQuotaScheduler — 失败不再静默', () => {
  it('批量 sweep 失败聚合一条 console.warn（含平台与账号）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const c = clock()
      const repo = fakeRepo({ byPlatform: { kiro: [acc('ok'), acc('bad')] }, activeByPlatform: {} })
      const quota = {
        refreshQuota: async (id: string) => {
          if (id === 'bad') throw new Error('boom')
        },
      }
      const sched = new PlatformQuotaScheduler(
        fakeSettings({}, { kiro: 10 }),
        repo as never,
        quota,
        undefined,
        c.now,
        60_000,
        ['kiro'],
      )
      c.advanceMinutes(10)
      await sched.tickOnce()
      expect(warn).toHaveBeenCalledTimes(1)
      const msg = String(warn.mock.calls[0][0])
      expect(msg).toContain('kiro')
      expect(msg).toContain('bad')
      expect(msg).toContain('boom')
    } finally {
      warn.mockRestore()
    }
  })

  it('活跃账号刷新失败也产生 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const c = clock()
      const repo = fakeRepo({
        byPlatform: { kiro: [acc('a')] },
        activeByPlatform: { kiro: acc('a') },
      })
      const quota = {
        refreshQuota: async () => {
          throw new Error('expired token')
        },
      }
      const sched = new PlatformQuotaScheduler(
        fakeSettings({ kiro: 5 }, { kiro: 0 }), // 批量关闭，只走活跃
        repo as never,
        quota,
        undefined,
        c.now,
        60_000,
        ['kiro'],
      )
      c.advanceMinutes(5)
      await sched.tickOnce()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('expired token')
    } finally {
      warn.mockRestore()
    }
  })
})
