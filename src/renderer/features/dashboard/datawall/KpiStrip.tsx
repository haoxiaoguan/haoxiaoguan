import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { skillsService, mcpService } from '@/services/tauri'

interface KpiStripProps {
  /** 账号总数 + 本周新增 + 平台覆盖（useAccountStats）。 */
  accountsTotal: number
  weekNew: number
  platformsCovered: number
  platformsTotal: number
  /** 本机会话总数 + 最近活跃（probeTools 推导）。 */
  sessionsTotal: number
  lastActive: { tool: string; at: number } | null
  /** 外部刷新信号。 */
  refreshNonce?: number
}

interface OnOff {
  on: number
  off: number
}

/** apps 任一客户端为 true = 启用（与 MCP/Skills 注入语义一致）。 */
function splitByApps(list: Array<{ apps: Record<string, boolean> }>): OnOff {
  let on = 0
  for (const item of list) if (Object.values(item.apps).some(Boolean)) on++
  return { on, off: list.length - on }
}

/** MCP / Skills 启停计数：进页拉一次，随 refreshNonce 重拉。失败按 0/0。 */
function useToolCounts(refreshNonce?: number): { mcp: OnOff | null; skills: OnOff | null } {
  const [mcp, setMcp] = useState<OnOff | null>(null)
  const [skills, setSkills] = useState<OnOff | null>(null)
  useEffect(() => {
    let alive = true
    void mcpService
      .getMcpServers()
      .then((list) => alive && setMcp(splitByApps(list)))
      .catch(() => alive && setMcp({ on: 0, off: 0 }))
    void skillsService
      .getInstalledSkills()
      .then((list) => alive && setSkills(splitByApps(list)))
      .catch(() => alive && setSkills({ on: 0, off: 0 }))
    return () => {
      alive = false
    }
  }, [refreshNonce])
  return { mcp, skills }
}

function relativeTime(ms: number, nowMs: number, tFn: TFunction): string {
  const diff = nowMs - ms
  if (diff < 60_000)     return tFn('session.justNow')
  if (diff < 3_600_000)  return tFn('session.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return tFn('session.hoursAgo',   { n: Math.floor(diff / 3_600_000) })
  return tFn('session.daysAgo', { n: Math.floor(diff / 86_400_000) })
}

/** KPI 单卡：左上主题色条 + 同色系浅渐变底 + 标题/大数(可带徽章)/副文字。 */
function KpiCell({
  accent,
  gradient,
  label,
  value,
  badge,
  hint,
  tooltip,
}: {
  accent: string
  gradient: string
  label: string
  value: string
  badge?: string
  hint: string
  /** 可选：标签旁的信息图标 + 悬浮说明（解释该指标口径）。 */
  tooltip?: string
}) {
  return (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-[14px] border border-border bg-card px-5 py-4 shadow-bento-light dark:shadow-bento',
        gradient,
      )}
    >
      <span className={cn('absolute left-5 top-0 h-[3px] w-10 rounded-b-full', accent)} aria-hidden />
      <div className="flex items-center gap-1">
        <p className="truncate text-[11px] font-medium leading-4 text-muted-foreground">{label}</p>
        {tooltip ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  className="shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                >
                  <Info className="size-3" strokeWidth={2} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-[12px] leading-snug">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <p
        className="mt-1 truncate text-[26px] font-extrabold leading-8 tracking-tight text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
        {badge != null && (
          <span className="ml-2 align-middle text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            {badge}
          </span>
        )}
      </p>
      <p className="mt-1 truncate text-[12px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  )
}

/** 顶部 KPI 条：账号数 / 会话数 / MCP 数量 / Skills 数量（蓝/橙/绿/紫四色卡）。 */
export function KpiStrip({
  accountsTotal,
  weekNew,
  platformsCovered,
  platformsTotal,
  sessionsTotal,
  lastActive,
  refreshNonce,
}: KpiStripProps) {
  const { t } = useTranslation('dashboard')
  const { mcp, skills } = useToolCounts(refreshNonce)

  const onOffHint = (v: OnOff | null) =>
    v == null ? '—' : t('kpis.enabledDisabled', { on: v.on, off: v.off })

  return (
    <div className="grid grid-cols-4 gap-2.5">
      <KpiCell
        accent="bg-blue-500"
        gradient="bg-gradient-to-br from-blue-500/[0.09] to-transparent"
        label={t('kpis.accounts')}
        value={accountsTotal.toLocaleString('en-US')}
        badge={weekNew > 0 ? t('kpis.weekNew', { n: weekNew }) : undefined}
        hint={t('kpis.platformsCovered', { x: platformsCovered, y: platformsTotal })}
      />
      <KpiCell
        accent="bg-orange-400"
        gradient="bg-gradient-to-br from-orange-400/[0.09] to-transparent"
        label={t('kpis.sessions')}
        value={sessionsTotal.toLocaleString('en-US')}
        tooltip={t('kpis.sessionsTooltip')}
        hint={
          lastActive != null
            ? `${lastActive.tool} · ${relativeTime(lastActive.at, Date.now(), t)}`
            : '—'
        }
      />
      <KpiCell
        accent="bg-emerald-500"
        gradient="bg-gradient-to-br from-emerald-500/[0.09] to-transparent"
        label={t('kpis.mcp')}
        value={mcp == null ? '—' : (mcp.on + mcp.off).toLocaleString('en-US')}
        hint={onOffHint(mcp)}
      />
      <KpiCell
        accent="bg-violet-500"
        gradient="bg-gradient-to-br from-violet-500/[0.09] to-transparent"
        label={t('kpis.skills')}
        value={skills == null ? '—' : (skills.on + skills.off).toLocaleString('en-US')}
        hint={onOffHint(skills)}
      />
    </div>
  )
}
