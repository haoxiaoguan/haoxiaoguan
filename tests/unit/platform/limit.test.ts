import { describe, it, expect } from 'vitest'
import { createLimit } from '../../../src/main/platform/async/limit'

describe('createLimit', () => {
  it('caps concurrency at the configured limit', async () => {
    const limit = createLimit(2)
    let active = 0
    let maxActive = 0
    const task = () =>
      limit(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
        return active
      })
    await Promise.all([task(), task(), task(), task(), task()])
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('returns each thunk result and propagates rejections per-call', async () => {
    const limit = createLimit(3)
    const ok = await limit(async () => 42)
    expect(ok).toBe(42)
    await expect(limit(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('treats concurrency < 1 as 1', async () => {
    const limit = createLimit(0)
    let active = 0
    let maxActive = 0
    const task = () =>
      limit(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
      })
    await Promise.all([task(), task(), task()])
    expect(maxActive).toBe(1)
  })
})
