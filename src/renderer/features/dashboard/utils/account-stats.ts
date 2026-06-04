export interface AccountStats {
  total: number
  platformsCovered: number
  platformsTotal: number
  todayActive: number
  weekNew: number
  perPlatform: Array<{ platform: string; count: number }>
}

/**
 * Compute account statistics from a platform→accounts map.
 *
 * @param accountsByPlatform  Map keyed by platform id. Values are account
 *   objects that at minimum carry createdAt (ISO string) and optional
 *   lastUsedAt (ISO string).
 * @param platforms           The canonical platform list (order preserved for
 *   perPlatform, but only platforms present in the list are included).
 * @param nowMs               Reference timestamp in milliseconds (Date.now()).
 */
export function computeAccountStats(
  accountsByPlatform: Map<string, Array<{ createdAt: string; lastUsedAt?: string }>>,
  platforms: string[],
  nowMs: number,
): AccountStats {
  const WEEK_MS = 7 * 86_400_000

  // Local-date helper: returns "YYYY-MM-DD" in local time for a given ms.
  function localDateStr(ms: number): string {
    const d = new Date(ms)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const todayStr = localDateStr(nowMs)
  const weekStartMs = nowMs - WEEK_MS

  let total = 0
  let platformsCovered = 0
  let todayActive = 0
  let weekNew = 0
  const perPlatform: Array<{ platform: string; count: number }> = []

  for (const platform of platforms) {
    const list = accountsByPlatform.get(platform) ?? []
    const count = list.length

    total += count
    if (count > 0) platformsCovered++

    perPlatform.push({ platform, count })

    for (const account of list) {
      if (account.lastUsedAt) {
        const usedMs = new Date(account.lastUsedAt).getTime()
        if (localDateStr(usedMs) === todayStr) {
          todayActive++
        }
      }
      const createdMs = new Date(account.createdAt).getTime()
      if (createdMs > weekStartMs) {
        weekNew++
      }
    }
  }

  // Sort perPlatform by count descending
  perPlatform.sort((a, b) => b.count - a.count)

  return {
    total,
    platformsCovered,
    platformsTotal: platforms.length,
    todayActive,
    weekNew,
    perPlatform,
  }
}
