import { describe, it, expect } from 'vitest'
import {
  presetRange,
  granularityFor,
  toWindow,
  formatRangeLabel,
  localDateKey,
} from '../../../src/renderer/features/dashboard/utils/time-range'
import { activityStats, heatLevel } from '../../../src/renderer/features/dashboard/utils/activity-stats'

// 2026-06-13 15:30:00 本地时间（周六）
const NOW = new Date(2026, 5, 13, 15, 30, 0).getTime()

describe('time-range', () => {
  it('presetRange today = 本地今日 00:00 起', () => {
    const r = presetRange('today', NOW)
    expect(new Date(r.startMs).getHours()).toBe(0)
    expect(localDateKey(r.startMs)).toBe('2026-06-13')
    expect(r.endMs).toBe(NOW)
  })

  it('presetRange 7d = 往前推 7 天整', () => {
    const r = presetRange('7d', NOW)
    expect(r.endMs - r.startMs).toBe(7 * 86_400_000)
  })

  it('granularityFor：48h 内 hour，超出 day', () => {
    expect(granularityFor({ startMs: NOW - 48 * 3_600_000, endMs: NOW })).toBe('hour')
    expect(granularityFor({ startMs: NOW - 48 * 3_600_000 - 1, endMs: NOW })).toBe('day')
  })

  it('toWindow 毫秒→秒向下取整', () => {
    const w = toWindow({ startMs: 1999, endMs: 3001 })
    expect(w).toEqual({ startSec: 1, endSec: 3 })
  })

  it('formatRangeLabel 本地格式', () => {
    expect(formatRangeLabel({ startMs: NOW, endMs: NOW })).toBe('2026/06/13 15:30 - 2026/06/13 15:30')
  })
})

describe('activity-stats', () => {
  it('今日/自然周(周一起)/自然月活跃天数', () => {
    // NOW=周六 2026-06-13；本周一=06-08；本月起=06-01
    const points = [
      { date: '2026-06-13', value: 12 }, // 今日 ✓ 周 ✓ 月 ✓
      { date: '2026-06-09', value: 3 },  // 周 ✓ 月 ✓
      { date: '2026-06-07', value: 5 },  // 上周日：周 ✗ 月 ✓
      { date: '2026-06-01', value: 1 },  // 月 ✓
      { date: '2026-05-31', value: 9 },  // 上月 ✗
      { date: '2026-06-10', value: 0 },  // value=0 不算活跃
    ]
    const s = activityStats(points, NOW)
    expect(s.todaySessions).toBe(12)
    expect(s.weekActiveDays).toBe(2) // 06-13, 06-09
    expect(s.monthActiveDays).toBe(4) // 13, 09, 07, 01
  })

  it('heatLevel 四分位与边界', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(5, 0)).toBe(0)
    expect(heatLevel(25, 100)).toBe(1)
    expect(heatLevel(26, 100)).toBe(2)
    expect(heatLevel(50, 100)).toBe(2)
    expect(heatLevel(75, 100)).toBe(3)
    expect(heatLevel(100, 100)).toBe(4)
  })
})
