import { describe, it, expect } from 'vitest'
import { makeAccountPoolHealthHandler } from '../../../src/main/contexts/apiProxy/application/account-pool-health-handler'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'

it('合并账号 meta（email/status）+ 运行态', async () => {
  const now = { t: 0 }
  const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
  health.markSuspended('a2')
  const accounts = { async listByPlatform() { return [
    { id: 'a1', email: 'a1@x', isActive: true },
    { id: 'a2', email: 'a2@x', isActive: true, status: 'SUSPENDED' },
  ] } } as any
  const handler = makeAccountPoolHealthHandler(health, accounts, 3_600_000)
  const rows = await handler()
  expect(rows).toEqual([
    { accountId: 'a1', email: 'a1@x', runtimeState: 'available', failureCount: 0 },
    { accountId: 'a2', email: 'a2@x', status: 'SUSPENDED', runtimeState: 'suspended', failureCount: 0 },
  ])
})

it('quota_exhausted 行携带 quotaResetsAtMs = quotaExhaustedAtMs + quotaResetMs', async () => {
  const exhaustedAt = 1_000_000
  const quotaResetMs = 7_200_000
  const now = { t: exhaustedAt }
  const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
  health.markRateLimited('a1')
  const accounts = { async listByPlatform() { return [
    { id: 'a1', email: 'a1@x', isActive: true },
  ] } } as any
  const handler = makeAccountPoolHealthHandler(health, accounts, quotaResetMs)
  const rows = await handler()
  expect(rows[0].runtimeState).toBe('quota_exhausted')
  expect(rows[0].quotaExhaustedAtMs).toBe(exhaustedAt)
  expect(rows[0].quotaResetsAtMs).toBe(exhaustedAt + quotaResetMs)
})
