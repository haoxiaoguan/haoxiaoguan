import { localDateKey } from './time-range'

/** 日桶活跃点（后端 day 粒度趋势的形状）。 */
export interface DailyPoint {
  /** 'YYYY-MM-DD'（localtime） */
  date: string
  value: number
}

export interface ActivityStats {
  /** 今日（本地日）会话数。 */
  todaySessions: number
  /** 本自然周（周一起）有会话的天数。 */
  weekActiveDays: number
  /** 本自然月有会话的天数。 */
  monthActiveDays: number
}

/** 本地自然周一 00:00 的日期 key 列表边界：返回本周一的 'YYYY-MM-DD'。 */
function mondayKey(now: number): string {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0=周日 … 6=周六；周一起算 → 周日回退 6 天。
  const back = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - back)
  return localDateKey(d.getTime())
}

/** 从近一年日桶算「今日会话 / 本周活跃天数 / 本月活跃天数」。纯函数（now 注入）。 */
export function activityStats(points: DailyPoint[], now: number): ActivityStats {
  const todayKey = localDateKey(now)
  const weekStart = mondayKey(now)
  const monthStart = todayKey.slice(0, 8) + '01'

  let todaySessions = 0
  let weekActiveDays = 0
  let monthActiveDays = 0
  for (const p of points) {
    if (p.value <= 0) continue
    if (p.date === todayKey) todaySessions = p.value
    // 字符串比较即日期序（同构 'YYYY-MM-DD'），上界 todayKey 防御未来脏数据。
    if (p.date >= weekStart && p.date <= todayKey) weekActiveDays++
    if (p.date >= monthStart && p.date <= todayKey) monthActiveDays++
  }
  return { todaySessions, weekActiveDays, monthActiveDays }
}

/** 热力图档位：0=无，1..4 按 value/max 四分位。max<=0 时恒 0。 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
