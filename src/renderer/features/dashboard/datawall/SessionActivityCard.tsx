import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface ToolEntry {
  tool: string
  count: number
  lastActiveAt?: number
}

interface Props {
  tools: ToolEntry[]
}

/** Map known tool names to a VIZ color. */
function toolColor(tool: string): string {
  const lower = tool.toLowerCase()
  if (lower.includes('codex'))  return VIZ.blue
  if (lower.includes('claude')) return VIZ.violet
  if (lower.includes('gemini')) return VIZ.green
  return VIZ.gray
}

/** Relative time — "N 分钟/小时/天前" or "刚刚". */
function relativeTime(ms: number, nowMs: number, tFn: TFunction): string {
  const diff = nowMs - ms
  if (diff < 60_000)     return tFn('session.justNow')
  if (diff < 3_600_000)  return tFn('session.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return tFn('session.hoursAgo',   { n: Math.floor(diff / 3_600_000) })
  return tFn('session.daysAgo', { n: Math.floor(diff / 86_400_000) })
}

/**
 * Session activity card — per-tool progress bars and a "most recent active" footer.
 */
export function SessionActivityCard({ tools }: Props) {
  const { t } = useTranslation('dashboard')
  const nowMs = Date.now()

  const maxCount = Math.max(...tools.map((e) => e.count), 1)

  // Find most recently active entry
  const mostRecent = tools.reduce<ToolEntry | null>((best, entry) => {
    if (!entry.lastActiveAt) return best
    if (!best || !best.lastActiveAt) return entry
    return entry.lastActiveAt > best.lastActiveAt ? entry : best
  }, null)

  return (
    <DataWallCard title={t('session.title')}>
      {tools.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-[12px] text-muted-foreground">
          —
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tools.map((entry) => {
            const barPct = (entry.count / maxCount) * 100
            const color = toolColor(entry.tool)
            return (
              <div key={entry.tool} className="flex items-center gap-2">
                {/* Tool name */}
                <span className="w-[64px] shrink-0 truncate text-[11px] text-muted-foreground">
                  {entry.tool}
                </span>
                {/* Progress bar */}
                <div className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{ width: `${barPct}%`, background: color }}
                    aria-label={`${entry.tool}: ${entry.count}`}
                  />
                </div>
                {/* Count */}
                <span className="w-[32px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
                  {entry.count}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: most recent active */}
      {mostRecent?.lastActiveAt != null && (
        <div className="mt-3 flex items-center gap-1 border-t border-border pt-2.5 text-[10px] text-muted-foreground">
          <span>{t('session.recentActive')}</span>
          <span className="font-medium text-foreground">{mostRecent.tool}</span>
          <span>·</span>
          <span>{relativeTime(mostRecent.lastActiveAt, nowMs, t)}</span>
        </div>
      )}
    </DataWallCard>
  )
}
