import { describe, it, expect } from 'vitest'
import {
  fillTrendGaps,
  formatTrendLabel,
  formatMetricValue,
} from '../../../../src/renderer/features/dashboard/utils/trend-fill'

describe('fillTrendGaps — day granularity', () => {
  it('fills a missing day in the middle', () => {
    const points = [
      { date: '2026-06-01', value: 5 },
      { date: '2026-06-03', value: 7 },
    ]
    const result = fillTrendGaps(points, 'day')

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2026-06-01', label: '06-01', value: 5 })
    expect(result[1]).toEqual({ date: '2026-06-02', label: '06-02', value: 0 })
    expect(result[2]).toEqual({ date: '2026-06-03', label: '06-03', value: 7 })
  })

  it('does not add buckets outside the min..max range', () => {
    const points = [
      { date: '2026-06-01', value: 1 },
      { date: '2026-06-02', value: 2 },
    ]
    const result = fillTrendGaps(points, 'day')
    expect(result).toHaveLength(2)
    expect(result[0].date).toBe('2026-06-01')
    expect(result[1].date).toBe('2026-06-02')
  })

  it('returns [] for empty input', () => {
    expect(fillTrendGaps([], 'day')).toEqual([])
  })

  it('returns single point with label for single-point input', () => {
    const result = fillTrendGaps([{ date: '2026-06-05', value: 42 }], 'day')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('06-05')
    expect(result[0].value).toBe(42)
  })
})

describe('fillTrendGaps — hour granularity', () => {
  it('does not insert extra buckets for two consecutive hours', () => {
    const points = [
      { date: '2026-06-01 10:00', value: 3 },
      { date: '2026-06-01 11:00', value: 5 },
    ]
    const result = fillTrendGaps(points, 'hour')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ date: '2026-06-01 10:00', label: '10:00', value: 3 })
    expect(result[1]).toEqual({ date: '2026-06-01 11:00', label: '11:00', value: 5 })
  })

  it('fills a missing hour in the middle with value=0', () => {
    const points = [
      { date: '2026-06-01 08:00', value: 1 },
      { date: '2026-06-01 10:00', value: 9 },
    ]
    const result = fillTrendGaps(points, 'hour')
    expect(result).toHaveLength(3)
    expect(result[1]).toEqual({ date: '2026-06-01 09:00', label: '09:00', value: 0 })
  })

  it('returns [] for empty input', () => {
    expect(fillTrendGaps([], 'hour')).toEqual([])
  })

  it('returns single point with label for single-point input', () => {
    const result = fillTrendGaps([{ date: '2026-06-01 14:00', value: 7 }], 'hour')
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('14:00')
  })
})

describe('formatTrendLabel', () => {
  it('hour → HH:00 in UTC', () => {
    expect(formatTrendLabel('2026-06-01 09:00', 'hour')).toBe('09:00')
    expect(formatTrendLabel('2026-06-01 00:00', 'hour')).toBe('00:00')
    expect(formatTrendLabel('2026-06-01 23:00', 'hour')).toBe('23:00')
  })

  it('day → MM-DD in UTC', () => {
    expect(formatTrendLabel('2026-06-01', 'day')).toBe('06-01')
    expect(formatTrendLabel('2026-01-31', 'day')).toBe('01-31')
  })
})

describe('formatMetricValue', () => {
  it('tokens ≥ 1M → x.xM', () => {
    expect(formatMetricValue(12_800_000, 'tokens')).toBe('12.8M')
    expect(formatMetricValue(1_000_000, 'tokens')).toBe('1.0M')
    expect(formatMetricValue(1_050_000, 'tokens')).toBe('1.1M')
    expect(formatMetricValue(1_100_000, 'tokens')).toBe('1.1M')
  })

  it('tokens ≥ 1K and < 1M → x.xK', () => {
    expect(formatMetricValue(1500, 'tokens')).toBe('1.5K')
    expect(formatMetricValue(1000, 'tokens')).toBe('1.0K')
    expect(formatMetricValue(999_999, 'tokens')).toBe('1000.0K')
  })

  it('tokens < 1K → integer string', () => {
    expect(formatMetricValue(0, 'tokens')).toBe('0')
    expect(formatMetricValue(42, 'tokens')).toBe('42')
    expect(formatMetricValue(999, 'tokens')).toBe('999')
  })

  it('count → thousands-separated en-US', () => {
    expect(formatMetricValue(1234, 'count')).toBe('1,234')
    expect(formatMetricValue(0, 'count')).toBe('0')
    expect(formatMetricValue(1_000_000, 'count')).toBe('1,000,000')
  })
})
