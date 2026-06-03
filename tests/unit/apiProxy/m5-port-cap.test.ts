import { describe, it, expect } from 'vitest'
import { AppSettings } from '../../../src/main/contexts/settings/domain/app-settings'

describe('apiProxyPort 上限', () => {
  it('接受 1024–65535', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ api_proxy_port: '65535' })
    expect(s.runtime.apiProxyPort).toBe(65535)
  })
  it('拒绝 >65535（回落默认 8788）', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ api_proxy_port: '70000' })
    expect(s.runtime.apiProxyPort).toBe(8788)
  })
  it('拒绝 <1024', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ api_proxy_port: '80' })
    expect(s.runtime.apiProxyPort).toBe(8788)
  })
})
