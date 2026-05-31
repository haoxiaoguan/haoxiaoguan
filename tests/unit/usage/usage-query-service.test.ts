/**
 * Unit tests for UsageQueryService — uses stub repositories.
 */
import { describe, it, expect } from 'vitest'
import { UsageQueryService } from '../../../src/main/contexts/usage/application/usage-query-service'
import type { UsageRollupRepository, UsageSyncStateRepository } from '../../../src/main/contexts/usage/domain/usage-repositories'
import type { UsageSyncResultState } from '../../../src/main/contexts/usage/domain/usage-record'

function makeRollupRepo(overrides: Partial<UsageRollupRepository> = {}): UsageRollupRepository {
  return {
    rebuildAll: async () => {},
    summary: async () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 }),
    trend: async () => [],
    platformBreakdown: async () => [],
    ...overrides,
  }
}

function makeSyncStateRepo(overrides: Partial<UsageSyncStateRepository> = {}): UsageSyncStateRepository {
  return {
    saveSyncResult: async () => {},
    latestSuccessfulSyncAt: async () => null,
    listSyncResultStates: async () => [],
    ...overrides,
  }
}

describe('UsageQueryService.summary', () => {
  it('computes totalTokens = inputTokens + outputTokens', async () => {
    const svc = new UsageQueryService(
      makeRollupRepo({ summary: async () => ({ inputTokens: 300, outputTokens: 150, cacheReadTokens: 20, cacheCreationTokens: 10, requests: 5 }) }),
      makeSyncStateRepo({ latestSuccessfulSyncAt: async () => 1700000000 }),
    )
    const s = await svc.summary('7d')
    expect(s.totalTokens).toBe(450)
    expect(s.inputTokens).toBe(300)
    expect(s.outputTokens).toBe(150)
    expect(s.lastSyncedAt).toBe(1700000000)
  })

  it('lastSyncedAt is null when no sync has run', async () => {
    const svc = new UsageQueryService(makeRollupRepo(), makeSyncStateRepo())
    const s = await svc.summary('30d')
    expect(s.lastSyncedAt).toBeNull()
  })
})

describe('UsageQueryService.trend', () => {
  it('totalTokens = inputTokens + outputTokens when metric is "tokens"', async () => {
    const svc = new UsageQueryService(
      makeRollupRepo({
        trend: async () => [{ date: '2023-11-14', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 3 }],
      }),
      makeSyncStateRepo(),
    )
    const points = await svc.trend('7d', 'tokens')
    expect(points[0].totalTokens).toBe(150)
    expect(points[0].requests).toBe(3)
  })

  it('totalTokens = requests when metric is "requests"', async () => {
    const svc = new UsageQueryService(
      makeRollupRepo({
        trend: async () => [{ date: '2023-11-14', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 7 }],
      }),
      makeSyncStateRepo(),
    )
    const points = await svc.trend('7d', 'requests')
    expect(points[0].totalTokens).toBe(7)
  })
})

describe('UsageQueryService.platformBreakdown', () => {
  it('computes shareRatio correctly', async () => {
    const svc = new UsageQueryService(
      makeRollupRepo({
        platformBreakdown: async () => [
          { platform: 'claude', inputTokens: 300, outputTokens: 100, cacheTokens: 0, requests: 5 },
          { platform: 'codex', inputTokens: 100, outputTokens: 100, cacheTokens: 0, requests: 2 },
        ],
      }),
      makeSyncStateRepo(),
    )
    const rows = await svc.platformBreakdown('30d')
    // grandTotal = (300+100) + (100+100) = 600
    expect(rows[0].shareRatio).toBeCloseTo(400 / 600)
    expect(rows[1].shareRatio).toBeCloseTo(200 / 600)
    expect(rows[0].shareRatio + rows[1].shareRatio).toBeCloseTo(1.0)
  })

  it('shareRatio is 0 when grandTotal is 0', async () => {
    const svc = new UsageQueryService(
      makeRollupRepo({
        platformBreakdown: async () => [
          { platform: 'claude', inputTokens: 0, outputTokens: 0, cacheTokens: 0, requests: 0 },
        ],
      }),
      makeSyncStateRepo(),
    )
    const rows = await svc.platformBreakdown('7d')
    expect(rows[0].shareRatio).toBe(0.0)
  })
})

describe('UsageQueryService.syncStatus', () => {
  it('healthStatus is "pending" when no sync has run', async () => {
    const svc = new UsageQueryService(makeRollupRepo(), makeSyncStateRepo())
    const st = await svc.syncStatus()
    expect(st.healthStatus).toBe('pending')
    expect(st.failedPlatforms).toEqual([])
    expect(st.supportedPlatforms).toContain('claude')
    expect(st.pendingPlatforms).toContain('cursor')
  })

  it('healthStatus is "healthy" when at least one platform succeeded', async () => {
    const states: UsageSyncResultState[] = [{ readerName: 'claude', status: 'success', updatedAt: 1700000000 }]
    const svc = new UsageQueryService(
      makeRollupRepo(),
      makeSyncStateRepo({ listSyncResultStates: async () => states }),
    )
    const st = await svc.syncStatus()
    expect(st.healthStatus).toBe('healthy')
    expect(st.failedPlatforms).toEqual([])
  })

  it('healthStatus is "warning" when any supported platform failed', async () => {
    const states: UsageSyncResultState[] = [
      { readerName: 'claude', status: 'success', updatedAt: 1700000000 },
      { readerName: 'kiro', status: 'failed', updatedAt: 1700000001 },
    ]
    const svc = new UsageQueryService(
      makeRollupRepo(),
      makeSyncStateRepo({ listSyncResultStates: async () => states }),
    )
    const st = await svc.syncStatus()
    expect(st.healthStatus).toBe('warning')
    expect(st.failedPlatforms).toContain('kiro')
    expect(st.failedPlatforms).not.toContain('claude')
  })
})

describe('UsageQueryService.recordSyncResult', () => {
  it('calls saveSyncResult with correct args', async () => {
    let capturedSucceeded: string[] = []
    let capturedFailed: string[] = []
    const svc = new UsageQueryService(
      makeRollupRepo(),
      makeSyncStateRepo({
        saveSyncResult: async (s, f) => { capturedSucceeded = s; capturedFailed = f },
      }),
    )
    await svc.recordSyncResult(['claude', 'codex'], ['kiro'])
    expect(capturedSucceeded).toEqual(['claude', 'codex'])
    expect(capturedFailed).toEqual(['kiro'])
  })
})
