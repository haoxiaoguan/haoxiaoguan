import { describe, it, expect } from 'vitest'
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
