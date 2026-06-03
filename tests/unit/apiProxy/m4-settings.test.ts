import { describe, it, expect } from 'vitest'
import { AppSettings } from '../../../src/main/contexts/settings/domain/app-settings'

describe('M4 settings 标量', () => {
  it('默认值齐全', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.apiProxySelectionStrategy).toBe('sticky-lru')
    expect(s.runtime.apiProxyAffinityTtlMs).toBe(600000)
    expect(s.runtime.apiProxyPerAccountConcurrency).toBe(4)
    expect(s.runtime.apiProxyMaxRetries).toBe(3)
    expect(s.runtime.apiProxyRetryDelayMs).toBe(100)
    expect(s.runtime.apiProxyBaseCooldownMs).toBe(1000)
    expect(s.runtime.apiProxyMaxBackoffMultiplier).toBe(64)
    expect(s.runtime.apiProxyQuotaResetMs).toBe(3600000)
    expect(s.runtime.apiProxyProbabilisticRetryChance).toBe(0.1)
  })
  it('fromJson 拒绝非法 strategy，回落默认', () => {
    const s = AppSettings.fromJson({ runtime: { apiProxySelectionStrategy: 'bogus' } })
    expect(s.runtime.apiProxySelectionStrategy).toBe('sticky-lru')
  })
  it('round-robin 合法', () => {
    const s = AppSettings.fromJson({ runtime: { apiProxySelectionStrategy: 'round-robin' } })
    expect(s.runtime.apiProxySelectionStrategy).toBe('round-robin')
  })
  it('toFlatKv / applyFlatKv 往返', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({
      api_proxy_selection_strategy: 'round-robin',
      api_proxy_per_account_concurrency: '8',
      api_proxy_max_retries: '5',
    })
    expect(s.runtime.apiProxySelectionStrategy).toBe('round-robin')
    expect(s.runtime.apiProxyPerAccountConcurrency).toBe(8)
    expect(s.runtime.apiProxyMaxRetries).toBe(5)
    const kv = s.toFlatKv()
    expect(kv.api_proxy_selection_strategy).toBe('round-robin')
    expect(kv.api_proxy_per_account_concurrency).toBe('8')
  })
  it('applyFlatKv 丢弃非整数并发数', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ api_proxy_per_account_concurrency: '0' }) // 须 ≥1
    expect(s.runtime.apiProxyPerAccountConcurrency).toBe(4)
  })
})
