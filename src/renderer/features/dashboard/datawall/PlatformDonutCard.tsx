import { useTranslation } from 'react-i18next'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface PlatformItem {
  platform: string
  count: number
}

interface Props {
  items: PlatformItem[]
  total: number
}

const SEGMENT_COLORS = [VIZ.blue, VIZ.violet, VIZ.green, VIZ.amber, VIZ.gray] as const

/** Capitalize first letter or map known platform ids to display names. */
function platformLabel(id: string): string {
  const MAP: Record<string, string> = {
    'cursor':        'Cursor',
    'windsurf':      'Windsurf',
    'kiro':          'Kiro',
    'github-copilot': 'Copilot',
    'codex':         'Codex',
    'gemini-cli':    'Gemini',
    'codebuddy':     'CodeBuddy',
    'codebuddy-cn':  'CodeBuddy CN',
    'qoder':         'Qoder',
    'trae':          'Trae',
    'zed':           'Zed',
  }
  return MAP[id] ?? (id.charAt(0).toUpperCase() + id.slice(1))
}

/**
 * Platform distribution donut card.
 * Shows up to 4 named platforms + an "others" segment as a conic-gradient donut,
 * with a legend list below.
 */
export function PlatformDonutCard({ items, total }: Props) {
  const { t } = useTranslation('dashboard')

  if (total === 0) {
    return (
      <DataWallCard title={t('platform.title')}>
        <div className="flex h-24 items-center justify-center text-[12px] text-muted-foreground">
          {t('platform.empty')}
        </div>
      </DataWallCard>
    )
  }

  // Build segments: top-4 + rest merged as "others"
  const sorted = [...items].sort((a, b) => b.count - a.count)
  const top4 = sorted.slice(0, 4)
  const othersCount = sorted.slice(4).reduce((s, i) => s + i.count, 0)

  type Segment = { label: string; count: number; color: string }
  const segments: Segment[] = top4.map((item, idx) => ({
    label: platformLabel(item.platform),
    count: item.count,
    color: SEGMENT_COLORS[idx],
  }))
  if (othersCount > 0) {
    segments.push({ label: t('platform.others'), count: othersCount, color: SEGMENT_COLORS[4] })
  }

  // Build conic-gradient stops
  let cursor = 0
  const stops: string[] = []
  for (const seg of segments) {
    const pct = (seg.count / total) * 100
    stops.push(`${seg.color} ${cursor.toFixed(1)}% ${(cursor + pct).toFixed(1)}%`)
    cursor += pct
  }
  const donutGradient = `conic-gradient(${stops.join(', ')})`

  return (
    <DataWallCard title={t('platform.title')}>
      <div className="flex items-center gap-4">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: donutGradient }}
            aria-hidden
          />
          {/* Inner cutout */}
          <div
            className="absolute rounded-full bg-card"
            style={{ inset: 14 }}
            aria-hidden
          />
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[13px] font-bold leading-none tabular-nums text-foreground">
              {total}
            </span>
            <span className="mt-0.5 text-[9px] text-muted-foreground">{t('platform.unit')}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center gap-1.5 overflow-hidden">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ background: seg.color }}
                aria-hidden
              />
              <span className="flex-1 truncate text-[11px] text-muted-foreground">
                {seg.label}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-foreground">
                {seg.count}
              </span>
            </div>
          ))}
        </div>
      </div>
    </DataWallCard>
  )
}
