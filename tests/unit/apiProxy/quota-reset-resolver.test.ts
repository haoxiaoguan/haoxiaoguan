import { describe, it, expect, vi } from 'vitest'
import { makeQuotaResetResolver } from '../../../src/main/container-helpers/quota-reset-resolver'

function state(resetAts: Array<Date | undefined>) {
  return { metrics: resetAts.map((resetAt) => ({ resetAt })) }
}

describe('makeQuotaResetResolver', () => {
  it('缓存命中且 resetAt 在未来 → 直接返回，不发 live', async () => {
    const now = 1000
    const getQuotaState = vi.fn(async () => state([new Date(5000)]))
    const refreshQuotaState = vi.fn(async () => state([new Date(9999)]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBe(5000)
    expect(getQuotaState).toHaveBeenCalledTimes(1)
    expect(refreshQuotaState).not.toHaveBeenCalled()
  })

  it('缓存 resetAt 已过期 → live 刷新再取', async () => {
    const now = 10000
    const getQuotaState = vi.fn(async () => state([new Date(5000)])) // 过期
    const refreshQuotaState = vi.fn(async () => state([new Date(20000)]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBe(20000)
    expect(refreshQuotaState).toHaveBeenCalledTimes(1)
  })

  it('缓存无 resetAt → live 刷新再取', async () => {
    const now = 0
    const getQuotaState = vi.fn(async () => state([undefined]))
    const refreshQuotaState = vi.fn(async () => state([new Date(7000)]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBe(7000)
  })

  it('getQuotaState 抛错 → 落 live', async () => {
    const now = 0
    const getQuotaState = vi.fn(async () => {
      throw new Error('cache miss')
    })
    const refreshQuotaState = vi.fn(async () => state([new Date(7000)]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBe(7000)
  })

  it('缓存与 live 都拿不到未来 resetAt → undefined（调用方兜底）', async () => {
    const now = 10000
    const getQuotaState = vi.fn(async () => state([new Date(5000)]))
    const refreshQuotaState = vi.fn(async () => state([undefined]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBeUndefined()
  })

  it('多 metric → 取最早的未来重置时间', async () => {
    const now = 1000
    const getQuotaState = vi.fn(async () =>
      state([new Date(9000), new Date(3000), new Date(500) /* 过期忽略 */, new Date(6000)]),
    )
    const refreshQuotaState = vi.fn(async () => state([]))
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBe(3000)
  })

  it('live 也抛错 → undefined', async () => {
    const now = 0
    const getQuotaState = vi.fn(async () => state([undefined]))
    const refreshQuotaState = vi.fn(async () => {
      throw new Error('live failed')
    })
    const r = makeQuotaResetResolver({ quotaService: { getQuotaState, refreshQuotaState }, clock: () => now })
    expect(await r.resetAtForAccount('a')).toBeUndefined()
  })
})
