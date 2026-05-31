/**
 * HealthChip — 8 状态彩色徽章。
 * 用 shadcn Badge variant="outline" + Tooltip。状态色通过外层圆点表达，
 * 文字用 muted-foreground 保持中性，避免和 Badge 自身配色冲突。
 */
import { useTranslation } from 'react-i18next';
import { badgeVariants } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHealthStore } from '../stores';
import type { ValidationState } from '../services/tauri';

interface HealthChipProps {
  accountId: string;
  refreshOnClick?: boolean;
}

const STATE_DOT: Record<ValidationState, string> = {
  valid: 'bg-emerald-500',
  expired: 'bg-amber-500',
  revoked: 'bg-red-500',
  rate_limited: 'bg-amber-500',
  network_error: 'bg-sky-500',
  unknown_error: 'bg-zinc-400',
  unsupported: 'bg-zinc-300 dark:bg-zinc-600',
  pending: 'bg-zinc-400 animate-pulse',
};

export default function HealthChip({ accountId, refreshOnClick = true }: HealthChipProps) {
  const { t } = useTranslation('accounts');
  const snapshot = useHealthStore((s) => s.snapshots.get(accountId));
  const refreshing = useHealthStore((s) => s.refreshing.has(accountId));
  const refresh = useHealthStore((s) => s.refresh);

  const state: ValidationState = snapshot?.validation.state ?? 'pending';
  const label = t(`health.${state}`);
  const tooltip = snapshot?.validation.details
    ? `${label} · ${snapshot.validation.details}`
    : label;

  const handleClick = () => {
    if (!refreshOnClick || refreshing) return;
    refresh(accountId);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={refreshing}
            className={cn(
              badgeVariants({ variant: 'outline' }),
              'gap-1.5 cursor-pointer text-muted-foreground hover:bg-accent',
              refreshing && 'opacity-60',
            )}
          >
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', STATE_DOT[state])} />
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
