import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type KpiAccent = 'blue' | 'amber' | 'emerald' | 'violet';

interface KpiCardProps {
  accent: KpiAccent;
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}

const ACCENT_BAR: Record<KpiAccent, string> = {
  blue: 'bg-[#2563eb]',
  amber: 'bg-[#f59e0b]',
  emerald: 'bg-[#22c55e]',
  violet: 'bg-[#8b5cf6]',
};

const ACCENT_GLOW: Record<KpiAccent, string> = {
  blue: 'from-[#2563eb]/12 via-transparent to-transparent',
  amber: 'from-[#f59e0b]/14 via-transparent to-transparent',
  emerald: 'from-[#22c55e]/14 via-transparent to-transparent',
  violet: 'from-[#8b5cf6]/14 via-transparent to-transparent',
};

const ACCENT_ICON: Record<KpiAccent, string> = {
  blue: 'bg-[#2563eb]/15 text-[#2563eb]',
  amber: 'bg-[#f59e0b]/15 text-[#f59e0b]',
  emerald: 'bg-[#22c55e]/15 text-[#22c55e]',
  violet: 'bg-[#8b5cf6]/15 text-[#8b5cf6]',
};

/**
 * KPI card — top thin colored accent bar, soft radial accent gradient,
 * giant numerical value, and a tiny icon chip in the upper-right.
 *
 * Visual reference: AiMaMi dashboard screenshots (data summary lane).
 */
export function KpiCard({ accent, icon: Icon, label, value, hint, className }: KpiCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-bento-light dark:shadow-bento',
        className,
      )}
    >
      {/* Top accent bar */}
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', ACCENT_BAR[accent])} aria-hidden />

      {/* Soft radial glow */}
      <div
        className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', ACCENT_GLOW[accent])}
        aria-hidden
      />

      <div className="relative flex flex-col gap-3 px-5 py-5">
        <div className="flex items-start justify-between">
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
          <span
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-lg',
              ACCENT_ICON[accent],
            )}
          >
            <Icon className="size-4" strokeWidth={1.85} />
          </span>
        </div>

        <div className="text-[40px] font-bold leading-none tracking-tight text-foreground">
          {value}
        </div>

        {hint ? (
          <div className="text-[12px] text-muted-foreground">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}
