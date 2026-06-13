import { describe, it, expect, vi } from 'vitest'
import {
  shouldFallbackToNextStep,
  runComboChain,
} from '../../../src/main/contexts/apiProxy/application/combo-orchestrator'

describe('shouldFallbackToNextStep', () => {
  it('客户端错误(400/413/422) → 不回退', () => {
    expect(shouldFallbackToNextStep({ status: 400 })).toBe(false)
    expect(shouldFallbackToNextStep({ status: 413 })).toBe(false)
    expect(shouldFallbackToNextStep({ status: 422 })).toBe(false)
  })
  it('限流/鉴权/无上游/5xx → 回退', () => {
    for (const status of [401, 403, 404, 408, 409, 429, 500, 502, 503, 504]) {
      expect(shouldFallbackToNextStep({ status })).toBe(true)
    }
  })
  it('无 status 的未知错误 → 保守回退', () => {
    expect(shouldFallbackToNextStep(new Error('boom'))).toBe(true)
    expect(shouldFallbackToNextStep(undefined)).toBe(true)
    expect(shouldFallbackToNextStep(null)).toBe(true)
    expect(shouldFallbackToNextStep({ status: 'nope' })).toBe(true)
  })
})

describe('runComboChain', () => {
  it('首跳成功即返回，不再尝试后续', async () => {
    const attempt = vi.fn(async (m: string) => `ok:${m}`)
    const r = await runComboChain(['a', 'b', 'c'], attempt)
    expect(r).toBe('ok:a')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('可回退错误顺链继续，命中下一跳成功', async () => {
    const attempt = vi.fn(async (m: string) => {
      if (m === 'a') throw { status: 429 }
      return `ok:${m}`
    })
    const r = await runComboChain(['a', 'b'], attempt)
    expect(r).toBe('ok:b')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('不可回退错误(400)立即抛，不试后续', async () => {
    const err = { status: 400, message: 'bad request' }
    const attempt = vi.fn(async (m: string) => {
      if (m === 'a') throw err
      return `ok:${m}`
    })
    await expect(runComboChain(['a', 'b'], attempt)).rejects.toBe(err)
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('全链失败抛最后一个错误', async () => {
    const last = { status: 503, message: 'last' }
    const attempt = vi.fn(async (m: string) => {
      if (m === 'a') throw { status: 429 }
      throw last
    })
    await expect(runComboChain(['a', 'b'], attempt)).rejects.toBe(last)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('空链抛错', async () => {
    await expect(runComboChain([], vi.fn())).rejects.toThrow(/no steps/)
  })

  it('支持自定义 shouldFallback', async () => {
    // 自定义：永不回退 → 首个错误即抛
    const err = { status: 503 }
    const attempt = vi.fn(async () => { throw err })
    await expect(runComboChain(['a', 'b'], attempt, () => false)).rejects.toBe(err)
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
