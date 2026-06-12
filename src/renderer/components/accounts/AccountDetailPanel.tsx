/**
 * AccountDetailPanel — 卡片视图右侧详情面板。
 * 设计参考设计稿 1：
 * - 顶部头像 + 名称 + 健康/活跃状态
 * - 基本信息分组
 * - 健康与配额（每个 model 一行进度条）
 * - 切换记录列表
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BentoInnerPanel } from '@/components/ui/bento-inner-panel';
import { cn } from '@/lib/utils';
import { useHealthStore, useQuotaStateStore } from '../../stores';
import type { Account } from '../../types';
import { PlatformMetricBlock } from './PlatformMetrics';
import { loginMethodLabel } from './account-plan';
import { PLATFORM_TONE, platformInitial } from './platform-tone';

interface AccountDetailPanelProps {
  account: Account | null;
  platformDisplayName: string;
  active?: boolean;
  switching?: boolean;
  onSwitch?: () => void;
  onDelete?: () => void;
  onClose?: () => void;
}

const HEALTH_DOT: Record<string, string> = {
  valid: 'bg-emerald-500',
  expired: 'bg-amber-500',
  revoked: 'bg-rose-500',
  rate_limited: 'bg-amber-500',
  network_error: 'bg-sky-500',
  unknown_error: 'bg-zinc-400',
  unsupported: 'bg-zinc-300 dark:bg-zinc-600',
  pending: 'bg-zinc-400 animate-pulse',
};

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

export default function AccountDetailPanel({
  account,
  platformDisplayName,
  active,
  switching,
  onSwitch,
  onDelete,
  onClose,
}: AccountDetailPanelProps) {
  const { t } = useTranslation('accounts');
  const snapshot = useHealthStore((s) => account ? s.snapshots.get(account.id) : undefined);
  const quotaState = useQuotaStateStore((s) => account ? s.states.get(account.id) : undefined);

  if (!account) {
    return (
      <div className="sticky top-4 hidden h-[calc(100vh-9rem)] xl:block">
        <BentoInnerPanel className="flex h-full flex-col items-center justify-center gap-3 border-dashed text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">{t('detail.empty')}</p>
        </BentoInnerPanel>
      </div>
    );
  }

  const tone = PLATFORM_TONE[account.platform];
  const state = snapshot?.validation.state ?? 'pending';
  const title = account.name || account.displayIdentifier || account.email;
  const identity = account.displayIdentifier || account.email;
  const hasEmail = account.email.includes('@');
  const statusText = [account.status, account.statusReason].filter(Boolean).join(' · ');
  const planText = [account.planName, account.planTier].filter(Boolean).join(' · ');

  return (
    <div className="sticky top-4 hidden h-[calc(100vh-9rem)] xl:block">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
        <div className={cn('absolute inset-x-0 top-0 h-[3px]', tone.bar)} aria-hidden />

        {/* head */}
        <div className="relative px-5 pb-4 pt-5">
          <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', tone.glow)} aria-hidden />
          <div className="relative flex items-start gap-3">
            <span
              className={cn(
                'inline-flex size-12 shrink-0 items-center justify-center rounded-2xl text-[18px] font-bold',
                tone.chip,
              )}
              aria-hidden
            >
              {platformInitial(platformDisplayName, account.platform)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-foreground">
                  {title}
                </h3>
                {active && (
                  <Badge className="h-5 bg-emerald-500/15 px-2 text-[10px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                    {t('card.active')}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{identity}</p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-medium uppercase tracking-wide',
                    tone.chip,
                  )}
                >
                  {platformDisplayName}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', HEALTH_DOT[state])} aria-hidden />
                  {t(`health.${state}`)}
                </span>
              </div>
            </div>
            {onClose && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] xl:hidden"
                onClick={onClose}
              >
                ×
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {/* 基本信息 */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('detail.section.basic')}
            </h4>
            <BentoInnerPanel className="space-y-2 p-4 text-[12px]">
              <DetailRow label={t('detail.field.identity')} value={identity} mono />
              <DetailRow label={t('detail.field.identityKey')} value={account.identityKey} mono />
              {hasEmail && <DetailRow label={t('detail.field.email')} value={account.email} />}
              <DetailRow label={t('detail.field.loginProvider')} value={loginMethodLabel(account)} />
              {planText && <DetailRow label={t('detail.field.plan')} value={planText} />}
              {statusText && <DetailRow label={t('detail.field.status')} value={statusText} />}
              <DetailRow label={t('detail.field.platform')} value={platformDisplayName} />
              <DetailRow
                label={t('detail.field.createdAt')}
                value={formatDateTime(account.createdAt)}
              />
              <DetailRow
                label={t('detail.field.lastUsedAt')}
                value={
                  account.lastUsedAt
                    ? formatDateTime(account.lastUsedAt)
                    : t('list.neverUsed')
                }
              />
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">{t('detail.field.tags')}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {account.tags.length > 0 ? (
                    account.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="h-5 px-1.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {t('card.tagsNone')}
                    </span>
                  )}
                </div>
              </div>
            </BentoInnerPanel>
          </section>

          {/* 平台详情 */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
              {t('detail.section.platform', { platform: platformDisplayName })}
            </h4>
            <BentoInnerPanel className="flex flex-col gap-3 p-4 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('detail.section.health')}</span>
                <span className="inline-flex items-center gap-1 text-[12px] text-foreground">
                  <span className={cn('size-1.5 rounded-full', HEALTH_DOT[state])} aria-hidden />
                  {t(`health.${state}`)}
                </span>
              </div>
              <PlatformMetricBlock account={account} quotaState={quotaState} compact />
            </BentoInnerPanel>
          </section>

          {/* 切换记录 */}
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('detail.section.history')}
            </h4>
            <BentoInnerPanel className="flex flex-col gap-2 p-4 text-[12px]">
              <SwitchStageLine label={t('detail.history.closeProcess')} value="120ms" ok />
              <SwitchStageLine label={t('detail.history.injectCredential')} value="35ms" ok />
              <SwitchStageLine label={t('detail.history.launchIde')} value={t('detail.history.success')} ok />
            </BentoInnerPanel>
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-5 py-3">
          {!active && onSwitch && (
            <Button
              size="sm"
              variant="default"
              className="h-8 flex-1 text-xs"
              disabled={!!switching}
              onClick={onSwitch}
            >
              {switching ? t('actions.switching') : t('actions.switch')}
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              {t('actions.delete')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SwitchStageLine({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span
          className={cn(
            'size-1.5 rounded-full',
            ok ? 'bg-emerald-500' : 'bg-muted-foreground/40',
          )}
          aria-hidden
        />
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-foreground',
          mono && 'font-mono text-[11px]',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
