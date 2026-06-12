import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { DailyPoint } from '../utils/activity-stats'
import { heatLevel } from '../utils/activity-stats'
import { localDateKey } from '../utils/time-range'

interface ActivityHeatmapProps {
  /** 近一年日桶（'YYYY-MM-DD' → 会话数）；缺日视为 0。 */
  points: DailyPoint[]
  /** 锚点（通常 Date.now()）：网格右端为本周。 */
  now: number
}

/** 主题色 5 档（0=无活跃）。bg-primary/NN 让暗色模式自动跟随主题。 */
const LEVEL_CLASS = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary',
] as const

const WEEKS = 53

/**
 * GitHub 风格活跃热力图：53 周 × 7 天，按日会话数分 4 档主题色深浅。
 * 列=周（周日起），右端=本周；月份标签标在「该月 1 号所在列」上方。
 */
export function ActivityHeatmap({ points, now }: ActivityHeatmapProps) {
  const { t } = useTranslation('dashboard')

  const monthNames = (t('heatmap.months') as string).split(',')

  const { cells, monthLabels, max } = useMemo(() => {
    const valueByDate = new Map(points.map((p) => [p.date, p.value]))
    let maxValue = 0
    for (const p of points) if (p.value > maxValue) maxValue = p.value

    // 网格终点 = 本周六（本周列补满）；起点 = 终点往前 53 周的周日。
    const end = new Date(now)
    end.setHours(0, 0, 0, 0)
    end.setDate(end.getDate() + (6 - end.getDay()))
    const start = new Date(end)
    start.setDate(end.getDate() - (WEEKS * 7 - 1))

    const today = localDateKey(now)
    const grid: { key: string; value: number; future: boolean }[] = []
    const labels: { week: number; text: string }[] = []
    let lastMonth = -1
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = localDateKey(d.getTime())
      grid.push({ key, value: valueByDate.get(key) ?? 0, future: key > today })
      // 月标签：每列(周)首日所在月与上一列不同 → 在该列标月份。
      if (i % 7 === 0) {
        const month = d.getMonth()
        if (month !== lastMonth) {
          if (lastMonth !== -1) labels.push({ week: i / 7, text: monthNames[month] ?? String(month + 1) })
          lastMonth = month
        }
      }
    }
    return { cells: grid, monthLabels: labels, max: maxValue }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, now, t])

  return (
    <div className="flex h-full min-h-0 flex-col justify-center">
      {/* 月份标签行（与网格同列宽：53 列 grid） */}
      <div className="grid pb-1" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
        {monthLabels.map((m) => (
          <span
            key={`${m.week}-${m.text}`}
            className="whitespace-nowrap text-[10px] leading-none text-muted-foreground"
            style={{ gridColumnStart: m.week + 1 }}
          >
            {m.text}
          </span>
        ))}
      </div>
      {/* 53×7 网格：列=周 */}
      <div
        className="grid gap-[2.5px]"
        style={{
          gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))`,
          gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
          gridAutoFlow: 'column',
          aspectRatio: `${WEEKS} / 7`,
        }}
        role="img"
        aria-label={t('heatmap.aria')}
      >
        {cells.map((cell) => (
          <div
            key={cell.key}
            title={cell.future ? undefined : `${cell.key} · ${t('heatmap.tooltip', { n: cell.value })}`}
            className={cn(
              'rounded-[2px]',
              cell.future ? 'bg-transparent' : LEVEL_CLASS[heatLevel(cell.value, max)],
            )}
          />
        ))}
      </div>
      {/* 图例 */}
      <div className="flex items-center justify-end gap-1 pt-1.5 text-[10px] text-muted-foreground">
        <span>{t('trend.less')}</span>
        {LEVEL_CLASS.map((cls) => (
          <span key={cls} className={cn('size-[8px] rounded-[2px]', cls)} />
        ))}
        <span>{t('trend.more')}</span>
      </div>
    </div>
  )
}
