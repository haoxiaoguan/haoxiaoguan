export type TrendGranularity = 'hour' | 'day'

export interface TrendPoint {
  date: string   // 'YYYY-MM-DD HH:00' for hour | 'YYYY-MM-DD' for day
  value: number
  /** Optional extra numeric fields (e.g. token breakdown). Passed through as-is; missing buckets get 0. */
  extra?: Record<string, number>
}

export interface FilledTrendPoint {
  date: string
  label: string
  value: number
  /** Extra numeric fields transparently forwarded from the input points. */
  extra?: Record<string, number>
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Parse a bucket string to a UTC timestamp (ms). */
function parseUtcMs(date: string, g: TrendGranularity): number {
  if (g === 'hour') {
    return new Date(date.replace(' ', 'T') + ':00Z').getTime()
  }
  return new Date(date + 'T00:00:00Z').getTime()
}

/** Rebuild the canonical bucket string from a UTC timestamp. */
function bucketKey(ms: number, g: TrendGranularity): string {
  const d = new Date(ms)
  if (g === 'hour') {
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:00`
  }
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const HOUR_MS = 3_600_000
const DAY_MS  = 86_400_000

/** Step size in ms for the given granularity. */
function stepMs(g: TrendGranularity): number {
  return g === 'hour' ? HOUR_MS : DAY_MS
}

// ── exported pure functions ───────────────────────────────────────────────────

/**
 * Format the label for a trend bucket.
 * hour → "HH:00"
 * day  → "MM-DD"
 */
export function formatTrendLabel(date: string, g: TrendGranularity): string {
  if (g === 'hour') {
    const ms = parseUtcMs(date, 'hour')
    const d = new Date(ms)
    const hh = String(d.getUTCHours()).padStart(2, '0')
    return `${hh}:00`
  }
  // day
  const ms = parseUtcMs(date, 'day')
  const d = new Date(ms)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

/**
 * Format a metric value for display.
 * tokens: ≥1e6 → "x.xM", ≥1e3 → "x.xK", otherwise integer string
 * count:  thousands separator via en-US locale
 */
export function formatMetricValue(value: number, kind: 'tokens' | 'count' | 'cost'): string {
  if (kind === 'cost') {
    // 美元金额，千分位 + 两位小数（$1,234.56）。
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (kind === 'tokens') {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`
    }
    return String(Math.round(value))
  }
  // count
  return value.toLocaleString('en-US')
}

/**
 * Fill gaps in a trend series so every bucket between min and max is present.
 * Missing buckets are inserted with value=0. Both endpoints are NOT extended
 * beyond the data range (no padding outside min..max).
 *
 * Empty input → []. Single-point input → single point with label.
 */
export function fillTrendGaps(points: TrendPoint[], g: TrendGranularity): FilledTrendPoint[] {
  if (points.length === 0) return []

  // Determine all extra keys present in the input so we can zero-fill them
  const extraKeys = new Set<string>()
  for (const p of points) {
    if (p.extra) {
      for (const k of Object.keys(p.extra)) extraKeys.add(k)
    }
  }
  const hasExtra = extraKeys.size > 0

  // Build a lookup by canonical bucket key → { value, extra }
  const lookup = new Map<string, { value: number; extra?: Record<string, number> }>()
  for (const p of points) {
    const key = bucketKey(parseUtcMs(p.date, g), g)
    lookup.set(key, { value: p.value, extra: p.extra })
  }

  const tsMsList = points.map((p) => parseUtcMs(p.date, g))
  const minMs = Math.min(...tsMsList)
  const maxMs = Math.max(...tsMsList)

  const step = stepMs(g)
  const result: FilledTrendPoint[] = []

  for (let ms = minMs; ms <= maxMs; ms += step) {
    const date = bucketKey(ms, g)
    const entry = lookup.get(date)
    const value = entry?.value ?? 0
    if (hasExtra) {
      // Build zero-filled extra, then overlay actual values if present
      const extra: Record<string, number> = {}
      for (const k of extraKeys) extra[k] = 0
      if (entry?.extra) {
        for (const k of extraKeys) {
          if (k in entry.extra) extra[k] = entry.extra[k]!
        }
      }
      result.push({ date, label: formatTrendLabel(date, g), value, extra })
    } else {
      result.push({ date, label: formatTrendLabel(date, g), value })
    }
  }

  return result
}
