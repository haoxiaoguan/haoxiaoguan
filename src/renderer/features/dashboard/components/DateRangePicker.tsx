import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TimeRange, RangePreset } from '../utils/time-range'
import { RANGE_PRESETS, presetRange, formatRangeLabel, localDateKey } from '../utils/time-range'

interface DateRangePickerProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  disabled?: boolean
}

const PRESET_LABEL_KEYS: Record<RangePreset, string> = {
  today: 'range.today',
  '1d': 'range.d1',
  '7d': 'range.d7',
  '14d': 'range.d14',
  '30d': 'range.d30',
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function toDateInput(ms: number): string {
  return localDateKey(ms)
}

function toTimeInput(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 'YYYY-MM-DD' + 'HH:mm' → epoch ms（本地时区）；非法输入返回 null。 */
function fromInputs(date: string, time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m || !t) return null
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(t[1]),
    Number(t[2]),
  ).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * 仪表盘时间范围选择器：主题色按钮 + 弹层（预设 / 起止日期时间 / 范围日历）。
 * 草稿态编辑，「确定」才提交 onChange；起止倒置时自动交换。
 */
export function DateRangePicker({ value, onChange, disabled = false }: DateRangePickerProps) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<TimeRange>(value)
  // 范围选择状态：下一次日历点击是否设为结束端。
  const [pickingEnd, setPickingEnd] = useState(false)
  // 日历当前展示的月份（该月 1 号的 ms）。
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(value.startMs)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  })

  // 打开时同步草稿到当前生效值。
  useEffect(() => {
    if (!open) return
    setDraft(value)
    setPickingEnd(false)
    const d = new Date(value.startMs)
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
  }, [open, value])

  const applyPreset = (preset: RangePreset) => {
    const next = presetRange(preset, Date.now())
    onChange(next)
    setOpen(false)
  }

  const apply = () => {
    // 自定义范围不带 preset（按钮显示完整起止）；起止倒置自动交换。
    const next =
      draft.startMs <= draft.endMs
        ? { startMs: draft.startMs, endMs: draft.endMs }
        : { startMs: draft.endMs, endMs: draft.startMs }
    onChange(next)
    setOpen(false)
  }

  const onPickDay = (dayStartMs: number) => {
    if (!pickingEnd) {
      setDraft({ startMs: dayStartMs, endMs: dayStartMs + 86_400_000 - 60_000 })
      setPickingEnd(true)
    } else {
      const endMs = dayStartMs + 86_400_000 - 60_000
      setDraft((prev) =>
        dayStartMs < prev.startMs
          ? { startMs: dayStartMs, endMs: prev.endMs }
          : { startMs: prev.startMs, endMs },
      )
      setPickingEnd(false)
    }
  }

  const setStartInputs = (date: string, time: string) => {
    const ms = fromInputs(date, time)
    if (ms !== null) setDraft((prev) => ({ ...prev, startMs: ms }))
  }
  const setEndInputs = (date: string, time: string) => {
    const ms = fromInputs(date, time)
    if (ms !== null) setDraft((prev) => ({ ...prev, endMs: ms }))
  }

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12px] font-medium transition-colors',
            disabled
              ? 'cursor-not-allowed text-muted-foreground/50'
              : 'text-muted-foreground hover:border-primary/50 hover:text-primary',
          )}
          aria-label={t('range.ariaLabel')}
        >
          <CalendarDays className="size-3.5" strokeWidth={1.9} aria-hidden />
          {/* 预设范围只显示短码（如 7d）；自定义范围显示完整起止 */}
          <span className="tabular-nums">
            {value.preset != null ? t(PRESET_LABEL_KEYS[value.preset]) : formatRangeLabel(value)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[560px] rounded-[14px] p-4">
        {/* 预设 chips */}
        <div className="flex items-center gap-1.5">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {t(PRESET_LABEL_KEYS[preset])}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-4">
          {/* 左列：起止日期时间 */}
          <div className="flex w-[220px] shrink-0 flex-col">
            <p className="text-[11px] text-muted-foreground">{t('range.hint')}</p>
            <DateTimeField
              label={t('range.start')}
              active={!pickingEnd}
              date={toDateInput(draft.startMs)}
              time={toTimeInput(draft.startMs)}
              onChange={setStartInputs}
              className="mt-2"
            />
            <DateTimeField
              label={t('range.end')}
              active={pickingEnd}
              date={toDateInput(draft.endMs)}
              time={toTimeInput(draft.endMs)}
              onChange={setEndInputs}
              className="mt-2.5"
            />
            <div className="mt-auto flex items-center gap-2 pt-4">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setOpen(false)}>
                {t('range.cancel')}
              </Button>
              <Button size="sm" className="flex-1" onClick={apply}>
                {t('range.apply')}
              </Button>
            </div>
          </div>

          {/* 右列：范围日历 */}
          <RangeCalendar
            viewMonth={viewMonth}
            onViewMonthChange={setViewMonth}
            startMs={Math.min(draft.startMs, draft.endMs)}
            endMs={Math.max(draft.startMs, draft.endMs)}
            onPickDay={onPickDay}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── 起/止 日期时间块 ───────────────────────────────────────────────────────────

function DateTimeField({
  label,
  active,
  date,
  time,
  onChange,
  className,
}: {
  label: string
  active: boolean
  date: string
  time: string
  onChange: (date: string, time: string) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] border px-3 py-2 transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-border bg-card',
        className,
      )}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(e.target.value, time)}
          className="min-w-0 flex-1 bg-transparent text-[13px] tabular-nums text-foreground outline-none [&::-webkit-calendar-picker-indicator]:hidden"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => onChange(date, e.target.value)}
          className="w-[64px] bg-transparent text-right text-[13px] tabular-nums text-foreground outline-none [&::-webkit-calendar-picker-indicator]:hidden"
        />
      </div>
    </div>
  )
}

// ── 范围日历 ──────────────────────────────────────────────────────────────────

function RangeCalendar({
  viewMonth,
  onViewMonthChange,
  startMs,
  endMs,
  onPickDay,
}: {
  viewMonth: number
  onViewMonthChange: (ms: number) => void
  startMs: number
  endMs: number
  onPickDay: (dayStartMs: number) => void
}) {
  const { t } = useTranslation('dashboard')
  const weekdays = (t('range.weekdays') as string).split(',')

  const view = new Date(viewMonth)
  const title = t('range.monthTitle', { year: view.getFullYear(), month: view.getMonth() + 1 })

  // 42 格：当月首日所在周的周日起。
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - first.getDay())
    const out: { ms: number; day: number; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      out.push({
        ms: d.getTime(),
        day: d.getDate(),
        inMonth: d.getMonth() === view.getMonth(),
      })
    }
    return out
  }, [viewMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const startKey = localDateKey(startMs)
  const endKey = localDateKey(endMs)

  const shiftMonth = (delta: number) =>
    onViewMonthChange(new Date(view.getFullYear(), view.getMonth() + delta, 1).getTime())

  return (
    <div className="min-w-0 flex-1 rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('range.prevMonth')}
        >
          <ChevronLeft className="size-4" strokeWidth={1.9} />
        </button>
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('range.nextMonth')}
        >
          <ChevronRight className="size-4" strokeWidth={1.9} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-0.5">
        {weekdays.map((w) => (
          <span key={w} className="py-1 text-center text-[11px] text-muted-foreground">
            {w}
          </span>
        ))}
        {cells.map((cell) => {
          const key = localDateKey(cell.ms)
          const isStart = key === startKey
          const isEnd = key === endKey
          const inRange = key > startKey && key < endKey
          return (
            <button
              key={cell.ms}
              type="button"
              onClick={() => onPickDay(cell.ms)}
              className={cn(
                'mx-auto flex size-8 items-center justify-center text-[12px] tabular-nums transition-colors',
                isStart || isEnd
                  ? 'rounded-[8px] bg-primary font-medium text-primary-foreground'
                  : inRange
                    ? 'w-full rounded-none bg-primary/10 text-primary'
                    : cn(
                        'rounded-[8px] hover:bg-muted',
                        cell.inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                      ),
              )}
            >
              {cell.day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
