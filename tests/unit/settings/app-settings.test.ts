import { describe, it, expect } from 'vitest'
import { AppSettings } from '../../../src/main/contexts/settings/domain/app-settings'

describe('AppSettings', () => {
  it('applies defaults for missing keys', () => {
    const s = AppSettings.fromJson({})
    expect(s.ui.theme).toBe('system')
    expect(s.ui.language).toBe('zh-CN')
    expect(s.ui.closeBehavior).toBe('minimize')
    expect(s.ui.utilityButtons).toBe('device,support,docs,notification')
    expect(s.runtime.wsPort).toBe(9876)
    expect(s.runtime.silentStart).toBe(false)
    expect(s.runtime.autostart).toBe(false)
  })

  it('round-trips through toJson/fromJson', () => {
    const s = AppSettings.fromJson({ ui: { theme: 'dark' }, runtime: { wsPort: 5000 } })
    const again = AppSettings.fromJson(s.toJson())
    expect(again.ui.theme).toBe('dark')
    expect(again.runtime.wsPort).toBe(5000)
  })

  it('projects to a flat KV map with snake_case keys', () => {
    const s = AppSettings.fromJson({
      ui: { theme: 'dark' },
      runtime: { wsPort: 5000, refreshIntervals: { Cursor: 5 } },
    })
    const kv = s.toFlatKv()
    expect(kv.theme).toBe('dark')
    expect(kv.ws_port).toBe('5000')
    expect(kv.refresh_interval_Cursor).toBe('5')
  })

  it('applies a flat KV update leniently (invalid ws_port ignored)', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ theme: 'light', ws_port: 'not-a-number', silent_start: 'true' })
    expect(s.ui.theme).toBe('light')
    expect(s.runtime.wsPort).toBe(9876) // unchanged: invalid value dropped
    expect(s.runtime.silentStart).toBe(true)
  })
})
