import { CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Account, AccountQuotaState } from '../../types';
import { PLATFORM_TONE } from './platform-tone';
import {
  metricLines,
  metricSummaryText,
  type MetricLine,
  type MetricTone,
} from './quota-display';

interface PlatformMetricModule {
  eyebrow?: string;
  badge?: string;
  identity?: {
    label: string;
    value: string;
  };
  lines: MetricLine[];
  summary: string[];
}

interface PlatformMetricBlockProps {
  account: Account;
  quotaState?: AccountQuotaState;
  className?: string;
  compact?: boolean;
}

interface PlatformMetricSummaryProps {
  account: Account;
  quotaState?: AccountQuotaState;
  className?: string;
}

export function getPlatformMetricModule(account: Account): PlatformMetricModule {
  return {
    badge: getPlatformMetricBadge(account),
    identity: getIdentityLine(account),
    lines: [],
    summary: [],
  };
}

export function getPlatformMetricBadge(account: Account): string | undefined {
  if (account.planTier) return formatTierBadge(account.planTier);
  return formatBadgeValue(account.planName ?? account.loginProvider);
}

function getIdentityLine(account: Account): PlatformMetricModule['identity'] {
  if (!account.identityKey || account.identityKey === account.displayIdentifier) return undefined;
  return {
    label: '身份:',
    value: account.identityKey,
  };
}

function formatBadgeValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function formatTierBadge(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed;
}

export function PlatformMetricSummary({
  account,
  quotaState,
  className,
}: PlatformMetricSummaryProps) {
  const item = metricSummaryText(quotaState, account);
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      <Badge
        variant="outline"
        className="h-5 max-w-full px-1.5 text-[10px] text-muted-foreground"
      >
        <span className="truncate">{item}</span>
      </Badge>
    </div>
  );
}

export function PlatformMetricBlock({
  account,
  quotaState,
  className,
  compact,
}: PlatformMetricBlockProps) {
  const tone = PLATFORM_TONE[account.platform];
  const module = quotaState ? undefined : getPlatformMetricModule(account);
  const eyebrow = module?.eyebrow;
  const identity = module?.identity;
  const lines = metricLines(account, quotaState);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(eyebrow || identity) && (
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {eyebrow && <span>{eyebrow}</span>}
          {identity && (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">{identity.label}</span>
              <span className="truncate font-mono">{identity.value}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {lines.map((line) => (
          <MetricLineView
            key={`${line.label}-${line.value ?? line.subLabel ?? ''}`}
            line={line}
            progressClassName={line.tone === 'normal' ? tone.progress : undefined}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function MetricLineView({
  line,
  progressClassName,
  compact,
}: {
  line: MetricLine;
  progressClassName?: string;
  compact?: boolean;
}) {
  const progressTone = progressClassName ?? progressColor(line.tone);
  const topRight = line.percentText ?? line.value;
  const bottomLeft = line.usageText ?? line.subLabel;
  const resetText = line.resetText;
  const hasBottom = !!bottomLeft || !!resetText;
  return (
    <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-medium text-foreground/80">
          {line.label}
        </span>
        {topRight && (
          <span className={cn('shrink-0 text-[12px] font-semibold tabular-nums', valueColor(line.tone))}>
            {topRight}
          </span>
        )}
      </div>

      {line.progress !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all', progressTone)}
            style={{ width: `${Math.max(0, Math.min(100, line.progress))}%` }}
            aria-hidden
          />
        </div>
      )}

      {hasBottom && (
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate tabular-nums">{bottomLeft ?? ''}</span>
          {resetText && (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <CalendarDays className="size-3" strokeWidth={1.8} aria-hidden />
              {resetText} 重置
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function progressColor(tone: MetricTone = 'normal'): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'warning':
      return 'bg-amber-500';
    case 'danger':
      return 'bg-rose-500';
    case 'muted':
      return 'bg-muted-foreground/25';
    case 'normal':
    default:
      return 'bg-primary';
  }
}

function valueColor(tone: MetricTone = 'normal'): string {
  switch (tone) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'warning':
      return 'text-amber-600 dark:text-amber-400';
    case 'danger':
      return 'text-rose-600 dark:text-rose-400';
    case 'muted':
      return 'text-muted-foreground';
    case 'normal':
    default:
      return 'text-foreground';
  }
}
