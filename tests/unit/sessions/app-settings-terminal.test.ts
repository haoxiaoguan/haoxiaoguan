import { describe, it, expect } from 'vitest'
import { AppSettings } from '../../../src/main/contexts/settings/domain/app-settings'

describe('terminalLaunchTemplate 标量', () => {
  it('默认空串', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.terminalLaunchTemplate).toBe('')
  })
  it('toFlatKv / applyFlatKv 往返', () => {
    const s = AppSettings.fromJson({})
    s.applyFlatKv({ terminal_launch_template: 'wt -d "{cwd}" cmd /k "{command}"' })
    expect(s.runtime.terminalLaunchTemplate).toBe('wt -d "{cwd}" cmd /k "{command}"')
    expect(s.toFlatKv().terminal_launch_template).toBe('wt -d "{cwd}" cmd /k "{command}"')
  })
})
