import { describe, it, expect } from 'vitest'
import { makeClearSuspensionHandler } from '../../../src/main/contexts/apiProxy/application/clear-suspension-handler'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'

describe('makeClearSuspensionHandler', () => {
  it('清运行态 + 持久化 status', async () => {
    const cleared: string[] = []
    const health = new AccountHealthTracker({
      baseCooldownMs: 1,
      maxBackoffMultiplier: 1,
      quotaResetMs: 1,
      probabilisticRetryChance: 0,
    })
    health.markSuspended('a')
    expect(health.isAvailable('a')).toBe(false)
    const handler = makeClearSuspensionHandler(health, {
      async clearSuspension(id: string) {
        cleared.push(id)
      },
    } as any)
    await handler('a')
    expect(health.isAvailable('a')).toBe(true)
    expect(cleared).toEqual(['a'])
  })
})
