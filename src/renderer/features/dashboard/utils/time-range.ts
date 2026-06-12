import type { TimeWindowDto, TrendGranularityDto } from '@shared/api-types'

/**
 * 仪表盘统一时间范围（epoch 毫秒，闭区间）。时间选择器产出，趋势/汇总查询消费。
 * preset 存在 = 来自预设（按钮显示短码如「7d」）；自定义范围无 preset（按钮显示完整起止）。
 */
export interface TimeRange {
  startMs: number
  endMs: number
  preset?: RangePreset
}

export type RangePreset = 'today' | '1d' | '7d' | '14d' | '30d'

export const RANGE_PRESETS: RangePreset[] = ['today', '1d', '7d', '14d', '30d']

const DAY_MS = 86_400_000

/** 预设 → 范围。today=本地今日 00:00 至 now；Nd=now 往前推 N 天。 */
export function presetRange(preset: RangePreset, now: number): TimeRange {
  if (preset === 'today') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return { startMs: d.getTime(), endMs: now, preset }
  }
  const days = preset === '1d' ? 1 : preset === '7d' ? 7 : preset === '14d' ? 14 : 30
  return { startMs: now - days * DAY_MS, endMs: now, preset }
}

/** 桶粒度：范围 ≤48h 用小时桶（曲线有形状），更长用日桶。 */
export function granularityFor(range: TimeRange): TrendGranularityDto {
  return range.endMs - range.startMs <= 48 * 3_600_000 ? 'hour' : 'day'
}

/** TimeRange(ms) → IPC 窗口(秒，闭区间)。 */
export function toWindow(range: TimeRange): TimeWindowDto {
  return { startSec: Math.floor(range.startMs / 1000), endSec: Math.floor(range.endMs / 1000) }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** 本地时间 'YYYY/MM/DD HH:mm'。 */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 选择器按钮标签：'2026/05/15 00:00 - 2026/06/13 03:44'。 */
export function formatRangeLabel(range: TimeRange): string {
  return `${formatDateTime(range.startMs)} - ${formatDateTime(range.endMs)}`
}

/** 本地日期 'YYYY-MM-DD'（与后端 localtime 日桶 key 同构）。 */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
