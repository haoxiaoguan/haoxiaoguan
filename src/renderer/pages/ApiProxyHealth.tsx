import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import type { AccountPoolHealthRow } from '@shared/api-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

// ─── runtime state badge ──────────────────────────────────────────────────────

const RUNTIME_STATE_TONE: Record<string, { className: string; dot: string }> = {
  available: { className: 'bg-emerald-500/10 text-emerald-700', dot: 'bg-emerald-500' },
  cooldown: { className: 'bg-yellow-500/10 text-yellow-700', dot: 'bg-yellow-500' },
  quota_exhausted: { className: 'bg-orange-500/10 text-orange-600', dot: 'bg-orange-500' },
  suspended: { className: 'bg-rose-500/10 text-rose-600', dot: 'bg-rose-500' },
};

function RuntimeStateBadge({ state, label }: { state: string; label: string }) {
  const tone = RUNTIME_STATE_TONE[state] ?? {
    className: 'bg-zinc-500/10 text-zinc-600',
    dot: 'bg-zinc-400',
  };
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium',
        tone.className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
      {label}
    </span>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function ApiProxyHealth() {
  const { t } = useTranslation('nav');
  const { error, poolHealth, fetchPoolHealth, clearSuspension } = useApiProxyStore();

  useEffect(() => {
    void fetchPoolHealth();
  }, [fetchPoolHealth]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* ── header row ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Activity className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-foreground leading-5">
            {t('poolHealth.title')}
          </div>
          {poolHealth.length > 0 && (
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {t('poolHealth.count', { count: poolHealth.length })}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => void fetchPoolHealth()}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t('poolHealth.refresh')}
        </Button>
      </div>

      {/* ── account list or empty state ──────────────────────────────── */}
      {poolHealth.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-card py-14">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Users className="size-5 text-muted-foreground" strokeWidth={1.85} />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">{t('poolHealth.empty')}</p>
            <p className="text-xs text-muted-foreground">{t('poolHealth.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('poolHealth.colAccount')}
                </TableHead>
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('poolHealth.colState')}
                </TableHead>
                <TableHead className="px-3 py-2 text-[11.5px] font-medium text-muted-foreground">
                  {t('poolHealth.colFailures')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right text-[11.5px] font-medium text-muted-foreground">
                  {t('poolHealth.colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {poolHealth.map((row: AccountPoolHealthRow) => {
                const isSuspended =
                  row.runtimeState === 'suspended' || row.status === 'SUSPENDED';
                let stateLabel = t(`poolHealth.state.${row.runtimeState}`);
                if (row.runtimeState === 'cooldown' && row.cooldownUntilMs !== undefined) {
                  const remaining = Math.max(0, Math.ceil((row.cooldownUntilMs - now) / 1000));
                  stateLabel = `${stateLabel} (${remaining}s)`;
                } else if (
                  row.runtimeState === 'quota_exhausted' &&
                  row.quotaResetsAtMs !== undefined
                ) {
                  const resetAt = new Date(row.quotaResetsAtMs).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  stateLabel = `${stateLabel} → ${resetAt}`;
                }

                return (
                  <TableRow
                    key={row.accountId}
                    className="border-b border-border/60 hover:bg-muted/30"
                  >
                    <TableCell className="px-3 py-2 text-[13px] font-medium text-foreground">
                      <span className="truncate block max-w-[220px]">{row.email}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <RuntimeStateBadge state={row.runtimeState} label={stateLabel} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-[12px] text-muted-foreground">
                      {row.failureCount > 0
                        ? t('poolHealth.failures', { count: row.failureCount })
                        : '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      {isSuspended ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 text-[12px]"
                          onClick={() => void clearSuspension(row.accountId)}
                        >
                          {t('poolHealth.clearSuspension')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
