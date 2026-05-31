/**
 * QuotaChip — 配额展示 chip。
 * 用 shadcn Badge variant="outline"，状态色用 className 调 border 与 text。
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHealthStore } from '../stores';
import type { QuotaOutcome } from '../services/tauri';

interface QuotaChipProps {
  accountId: string;
  modelName?: string;
}

const OUTCOME_TONE: Record<QuotaOutcome, string> = {
  success: 'text-foreground',
  unsupported: 'text-muted-foreground',
  stale: 'border-amber-500/40 text-amber-700 dark:text-amber-400',
  failed: 'border-red-500/40 text-red-700 dark:text-red-400',
};

export default function QuotaChip({ accountId, modelName }: QuotaChipProps) {
  const { t } = useTranslation('accounts');
  const snapshot = useHealthStore((s) => s.snapshots.get(accountId));
  const quota = snapshot?.quota;

  if (!quota) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        — / —
      </Badge>
    );
  }

  const aggregated = modelName
    ? quota.models.find((m) => m.model_name === modelName)
    : quota.models.reduce<{ used: number; total: number }>(
        (acc, m) => ({ used: acc.used + m.used, total: acc.total + m.total }),
        { used: 0, total: 0 },
      );

  const used = aggregated?.used ?? 0;
  const total = aggregated?.total ?? 0;
  const ratio = total > 0 ? Math.min(used / total, 1) : 0;
  const ratioTone =
    quota.outcome !== 'success'
      ? OUTCOME_TONE[quota.outcome]
      : ratio > 0.9
      ? 'border-red-500/40 text-red-700 dark:text-red-400'
      : ratio > 0.7
      ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
      : 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400';

  const tooltip = `${t(`quota.outcome.${quota.outcome}`)} · ${used}/${total}`;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn(ratioTone)}>
            {total > 0 ? `${used} / ${total}` : t(`quota.outcome.${quota.outcome}`)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
