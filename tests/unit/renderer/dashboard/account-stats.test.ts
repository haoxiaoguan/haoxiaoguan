import { describe, it, expect } from 'vitest'
import { computeAccountStats } from '../../../../src/renderer/features/dashboard/utils/account-stats'

const PLATFORMS = ['cursor', 'windsurf', 'kiro']

// nowMs chosen so "today" in local time is 2026-06-05 (arbitrary fixed point)
// We use a fixed UTC noon to avoid local-timezone boundary issues in CI:
//   2026-06-05T12:00:00Z  →  local date is 2026-06-05 in all UTC-N timezones
//   (UTC+12 → 2026-06-06 midnight, edge case — avoided by using noon)
// For simplicity we use midnight UTC and accept that very-negative-offset
// environments might shift to 2026-06-04.  Tests use UTC-safe construction.
const NOW_MS = new Date('2026-06-05T12:00:00Z').getTime()
const WEEK_MS = 7 * 86_400_000

function iso(ms: number) {
  return new Date(ms).toISOString()
}

describe('computeAccountStats', () => {
  it('total is the sum across all platforms', () => {
    const map = new Map([
      ['cursor', [{ createdAt: iso(NOW_MS - 1000) }]],
      ['windsurf', [{ createdAt: iso(NOW_MS - 2000) }, { createdAt: iso(NOW_MS - 3000) }]],
      ['kiro', []],
    ])
    const stats = computeAccountStats(map, PLATFORMS, NOW_MS)
    expect(stats.total).toBe(3)
  })

  it('platformsCovered counts only platforms with ≥1 account', () => {
    const map = new Map([
      ['cursor', [{ createdAt: iso(NOW_MS - 1000) }]],
      ['windsurf', []],
      ['kiro', []],
    ])
    const stats = computeAccountStats(map, PLATFORMS, NOW_MS)
    expect(stats.platformsCovered).toBe(1)
    expect(stats.platformsTotal).toBe(3)
  })

  it('platformsTotal equals platforms.length regardless of map contents', () => {
    const stats = computeAccountStats(new Map(), PLATFORMS, NOW_MS)
    expect(stats.platformsTotal).toBe(PLATFORMS.length)
  })

  it('todayActive counts accounts whose lastUsedAt is on the same local date as nowMs', () => {
    // lastUsedAt 1 hour before NOW_MS → same local day
    const sameDay = iso(NOW_MS - 3_600_000)
    // lastUsedAt 2 days ago → different day
    const otherDay = iso(NOW_MS - 2 * 86_400_000)

    const map = new Map([
      ['cursor', [{ createdAt: iso(NOW_MS - 10_000), lastUsedAt: sameDay }]],
      ['windsurf', [{ createdAt: iso(NOW_MS - 10_000), lastUsedAt: otherDay }]],
      ['kiro', [{ createdAt: iso(NOW_MS - 10_000) }]],  // no lastUsedAt
    ])
    const stats = computeAccountStats(map, PLATFORMS, NOW_MS)
    expect(stats.todayActive).toBe(1)
  })

  it('weekNew counts accounts created strictly after (nowMs - 7 days)', () => {
    // Created 6 days ago → inside 7-day window
    const recentCreated = iso(NOW_MS - 6 * 86_400_000)
    // Created exactly 7 days ago → NOT inside (createdMs === weekStartMs, not >)
    const boundaryCreated = iso(NOW_MS - WEEK_MS)
    // Created 8 days ago → outside
    const oldCreated = iso(NOW_MS - 8 * 86_400_000)

    const map = new Map([
      ['cursor', [{ createdAt: recentCreated }]],
      ['windsurf', [{ createdAt: boundaryCreated }]],
      ['kiro', [{ createdAt: oldCreated }]],
    ])
    const stats = computeAccountStats(map, PLATFORMS, NOW_MS)
    expect(stats.weekNew).toBe(1)
  })

  it('perPlatform is sorted by count descending and only includes platforms from the list', () => {
    const map = new Map([
      ['cursor', [{ createdAt: iso(NOW_MS) }]],
      ['windsurf', [{ createdAt: iso(NOW_MS) }, { createdAt: iso(NOW_MS) }, { createdAt: iso(NOW_MS) }]],
      ['kiro', [{ createdAt: iso(NOW_MS) }, { createdAt: iso(NOW_MS) }]],
      ['unknown_platform', [{ createdAt: iso(NOW_MS) }]],  // not in PLATFORMS
    ])
    const stats = computeAccountStats(map, PLATFORMS, NOW_MS)
    expect(stats.perPlatform[0].platform).toBe('windsurf')
    expect(stats.perPlatform[0].count).toBe(3)
    expect(stats.perPlatform[1].platform).toBe('kiro')
    expect(stats.perPlatform[1].count).toBe(2)
    expect(stats.perPlatform[2].platform).toBe('cursor')
    expect(stats.perPlatform[2].count).toBe(1)
    // unknown_platform must not appear
    expect(stats.perPlatform.map((p) => p.platform)).not.toContain('unknown_platform')
  })

  it('returns all-zero stats for empty map', () => {
    const stats = computeAccountStats(new Map(), PLATFORMS, NOW_MS)
    expect(stats.total).toBe(0)
    expect(stats.platformsCovered).toBe(0)
    expect(stats.todayActive).toBe(0)
    expect(stats.weekNew).toBe(0)
  })
})
