import { describe, it, expect } from 'vitest'
import { makeAccountPoolHealthHandler } from '../../../src/main/contexts/apiProxy/application/account-pool-health-handler'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'

it('合并账号 meta（email/status）+ 运行态', async () => {
  const now = { t: 0 }
  const health = new AccountHealthTracker({
    baseCooldownMs: 1000,
    maxBackoffMultiplier: 64,
    quotaResetMs: 3600000,
    probabilisticRetryChance: 0,
    clock: () => now.t,
    random: () => 1,
  })
  health.markSuspended('a2')
  const accounts = {
    async listByPlatform() {
      return [
        { id: 'a1', email: 'a1@x', isActive: true },
        { id: 'a2', email: 'a2@x', isActive: true, status: 'SUSPENDED' },
      ]
    },
  } as any
  const handler = makeAccountPoolHealthHandler({ health, accounts, quotaResetMs: 3_600_000 })
  const rows = await handler()
  expect(rows).toEqual([
    {
      accountId: 'a1',
      platform: 'kiro',
      email: 'a1@x',
      runtimeState: 'available',
      failureCount: 0,
      pooled: false,
      priority: 0,
      concurrency: 4,
      rateLimitCooldownMs: 0,
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      avgDurationMs: 0,
      peakRpm: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    },
    {
      accountId: 'a2',
      platform: 'kiro',
      email: 'a2@x',
      status: 'SUSPENDED',
      runtimeState: 'suspended',
      failureCount: 0,
      pooled: false,
      priority: 0,
      concurrency: 4,
      rateLimitCooldownMs: 0,
      requests: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      avgDurationMs: 0,
      peakRpm: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    },
  ])
})

it('quota_exhausted 行携带 quotaResetsAtMs = quotaExhaustedAtMs + quotaResetMs', async () => {
  const exhaustedAt = 1_000_000
  const quotaResetMs = 7_200_000
  const now = { t: exhaustedAt }
  const health = new AccountHealthTracker({
    baseCooldownMs: 1000,
    maxBackoffMultiplier: 64,
    quotaResetMs,
    probabilisticRetryChance: 0,
    clock: () => now.t,
    random: () => 1,
  })
  health.markQuotaExhausted('a1')
  const accounts = {
    async listByPlatform() {
      return [{ id: 'a1', email: 'a1@x', isActive: true }]
    },
  } as any
  const handler = makeAccountPoolHealthHandler({ health, accounts, quotaResetMs })
  const rows = await handler()
  expect(rows[0].runtimeState).toBe('quota_exhausted')
  expect(rows[0].quotaExhaustedAtMs).toBe(exhaustedAt)
  expect(rows[0].quotaResetsAtMs).toBe(exhaustedAt + quotaResetMs)
})

it('rate_limited 行携带 rateLimitedUntilMs（429 短冷却，非配额耗尽）', async () => {
  const now = { t: 1_000 }
  const health = new AccountHealthTracker({
    baseCooldownMs: 1000,
    maxBackoffMultiplier: 64,
    quotaResetMs: 3_600_000,
    rateLimitCooldownMs: 60_000,
    probabilisticRetryChance: 0,
    clock: () => now.t,
    random: () => 1,
  })
  health.markRateLimited('a1')
  const accounts = {
    async listByPlatform() {
      return [{ id: 'a1', email: 'a1@x', isActive: true }]
    },
  } as any
  const handler = makeAccountPoolHealthHandler({ health, accounts, quotaResetMs: 3_600_000 })
  const rows = await handler()
  expect(rows[0].runtimeState).toBe('rate_limited')
  expect(rows[0].rateLimitedUntilMs).toBe(1_000 + 60_000)
  expect(rows[0].quotaExhaustedAtMs).toBeUndefined()
})

it('合并入池标识(pool.has) + 路由日志按账号统计', async () => {
  const now = { t: 0 }
  const health = new AccountHealthTracker({
    baseCooldownMs: 1000,
    maxBackoffMultiplier: 64,
    quotaResetMs: 3600000,
    probabilisticRetryChance: 0,
    clock: () => now.t,
    random: () => 1,
  })
  const accounts = {
    async listByPlatform() {
      return [
        { id: 'a1', email: 'a1@x', isActive: true },
        { id: 'a2', email: 'a2@x', isActive: true },
      ]
    },
  } as any
  const pool = {
    has: (id: string) => id === 'a1',
    getPriority: (id: string) => (id === 'a1' ? 7 : 0),
    getConcurrency: (id: string) => (id === 'a1' ? 9 : 4),
    getRateLimitCooldownMs: (id: string) => (id === 'a1' ? 30000 : 0),
  } as any
  const routingObs = {
    async accountStats() {
      return [
        {
          accountId: 'a1',
          requests: 5,
          success: 4,
          failed: 1,
          rateLimited: 2,
          avgDurationMs: 120,
          peakRpm: 3,
          inputTokens: 111,
          outputTokens: 222,
          cacheTokens: 333,
          lastTsMs: 999,
        },
      ]
    },
  } as any
  const handler = makeAccountPoolHealthHandler({
    health,
    accounts,
    quotaResetMs: 3_600_000,
    pool,
    routingObs,
  })
  const rows = await handler({ startSec: 0, endSec: 1 })
  const a1 = rows.find((r) => r.accountId === 'a1')!
  expect(a1.pooled).toBe(true)
  expect(a1.priority).toBe(7)
  expect(a1.concurrency).toBe(9)
  expect(a1.rateLimitCooldownMs).toBe(30000)
  expect(a1).toMatchObject({
    requests: 5,
    success: 4,
    failed: 1,
    rateLimited: 2,
    avgDurationMs: 120,
    peakRpm: 3,
    inputTokens: 111,
    outputTokens: 222,
    cacheTokens: 333,
    lastRequestMs: 999,
  })
  const a2 = rows.find((r) => r.accountId === 'a2')!
  expect(a2.pooled).toBe(false)
  expect(a2.priority).toBe(0)
  expect(a2).toMatchObject({
    requests: 0,
    success: 0,
    failed: 0,
    rateLimited: 0,
    avgDurationMs: 0,
    peakRpm: 0,
  })
})
