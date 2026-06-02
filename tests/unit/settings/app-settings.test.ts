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

  it('round-trips platform batch interval and ide path through flat KV', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({
      'platform_refresh_interval_kiro': '60',
      'platform_refresh_interval_cursor': '0', // 0 = disabled, must be kept
      'ide_path_kiro': '/Applications/Kiro.app',
    })
    expect(s.runtime.platformRefreshIntervals.kiro).toBe(60)
    expect(s.runtime.platformRefreshIntervals.cursor).toBe(0)
    expect(s.runtime.idePaths.kiro).toBe('/Applications/Kiro.app')

    const kv = s.toFlatKv()
    expect(kv['platform_refresh_interval_kiro']).toBe('60')
    expect(kv['platform_refresh_interval_cursor']).toBe('0')
    expect(kv['ide_path_kiro']).toBe('/Applications/Kiro.app')

    // Survives a full fromJson(toJson()) cycle.
    const again = AppSettings.fromJson(s.toJson())
    expect(again.runtime.platformRefreshIntervals.kiro).toBe(60)
    expect(again.runtime.idePaths.kiro).toBe('/Applications/Kiro.app')
  })

  it('drops an out-of-range platform batch interval', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ 'platform_refresh_interval_kiro': '5' }) // below the 10 min floor
    expect(s.runtime.platformRefreshIntervals.kiro).toBeUndefined()
    s.applyFlatKv({ 'platform_refresh_interval_kiro': '999' }) // above the 240 ceiling
    expect(s.runtime.platformRefreshIntervals.kiro).toBeUndefined()
  })

  it('persists ide_path now (previously silently dropped) and clears on empty', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ 'ide_path_cursor': '/usr/bin/cursor' })
    expect(s.runtime.idePaths.cursor).toBe('/usr/bin/cursor')
    s.applyFlatKv({ 'ide_path_cursor': '   ' }) // whitespace clears it
    expect(s.runtime.idePaths.cursor).toBeUndefined()
  })
})
