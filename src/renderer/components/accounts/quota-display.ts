import type { Account, AccountQuotaState, QuotaMetric, QuotaStatus } from '../../types';

export type MetricTone = 'normal' | 'success' | 'warning' | 'danger' | 'muted';

export interface MetricLine {
  label: string;
  value?: string;
  subLabel?: string;
  subValue?: string;
  progress?: number;
  tone?: MetricTone;
}

export function primaryMetric(state?: AccountQuotaState): QuotaMetric | undefined {
  if (!state) return undefined;
  if (state.primaryMetricKey) {
    return state.metrics.find((metric) => metric.key === state.primaryMetricKey) ?? state.metrics[0];
  }
  return state.metrics[0];
}

export function metricSummaryText(state?: AccountQuotaState, account?: Account): string {
  if (!state) return fallbackAccountSummary(account);
  const primary = primaryMetric(state);
  if (!primary) return fallbackStatusText(state.status);
  const value = primary.displayValue ?? formatMetricValue(primary);
  return value ? `${primary.label} ${value}` : primary.label;
}

export function metricLines(account: Account, state?: AccountQuotaState): MetricLine[] {
  if (!state) return fallbackLines(account);
  if (state.metrics.length === 0) {
    return [
      {
        label: fallbackStatusText(state.status),
        value: state.error,
        progress: 0,
        tone: toneFromStatus(state.status),
      },
    ];
  }

  return state.metrics.map((metric) => ({
    label: metric.label,
    value: metric.displayValue ?? formatMetricValue(metric),
    subLabel: formatMetricSubLabel(metric),
    subValue: metric.resetAt ? `重置：${new Date(metric.resetAt).toLocaleString()}` : undefined,
    progress: metric.kind === 'remaining'
      ? metric.percentRemaining ?? metric.percentUsed
      : metric.percentUsed ?? metric.percentRemaining,
    tone: metricTone(account, metric),
  }));
}

function metricTone(account: Account, metric: QuotaMetric): MetricTone {
  if (
    account.platform === 'codex' &&
    metric.kind === 'remaining' &&
    isFiniteNumber(metric.percentRemaining)
  ) {
    if (metric.percentRemaining < 20) return 'danger';
    if (metric.percentRemaining < 50) return 'warning';
    return 'success';
  }
  return toneFromStatus(metric.status);
}

function formatMetricValue(metric: QuotaMetric): string | undefined {
  if (isFiniteNumber(metric.percentRemaining) && metric.kind === 'remaining') {
    return `${Math.round(metric.percentRemaining)}% 剩余`;
  }
  if (isFiniteNumber(metric.percentUsed)) {
    return `${Math.round(metric.percentUsed)}%`;
  }
  if (isFiniteNumber(metric.remaining)) {
    return `${metric.remaining}`;
  }
  if (isFiniteNumber(metric.used) && isFiniteNumber(metric.total)) {
    return `${metric.used} / ${metric.total}`;
  }
  return undefined;
}

function formatMetricSubLabel(metric: QuotaMetric): string | undefined {
  if (isFiniteNumber(metric.used) && isFiniteNumber(metric.total)) {
    return `${metric.used} / ${metric.total}`;
  }
  return undefined;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fallbackStatusText(status: QuotaStatus): string {
  switch (status) {
    case 'unsupported':
      return '额度未支持';
    case 'error':
      return '额度获取失败';
    case 'unknown':
      return '额度未知';
    case 'exhausted':
      return '额度已耗尽';
    case 'warning':
      return '额度紧张';
    case 'ok':
    default:
      return '额度正常';
  }
}

function toneFromStatus(status: QuotaStatus): MetricTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warning':
      return 'warning';
    case 'exhausted':
    case 'error':
      return 'danger';
    case 'unsupported':
    case 'unknown':
    default:
      return 'muted';
  }
}

function fallbackLines(account: Account): MetricLine[] {
  const lines: MetricLine[] = [];
  const plan = account.planTier ?? account.planName;
  if (plan) {
    lines.push({
      label: '套餐',
      value: plan,
      progress: 100,
      tone: 'success',
    });
  }
  if (account.loginProvider) {
    lines.push({
      label: '登录来源',
      value: account.loginProvider,
      progress: 100,
      tone: 'success',
    });
  }
  if (account.status) {
    lines.push({
      label: '平台状态',
      value: account.status,
      progress: statusProgress(account.status),
      tone: accountStatusTone(account.status),
    });
  }
  if (lines.length > 0) return lines;

  return [{
    label: account.platform === 'kiro' ? '凭据状态' : '额度',
    value: '等待同步',
    progress: 0,
    tone: 'muted',
  }];
}

function fallbackAccountSummary(account?: Account): string {
  if (!account) return '额度未知';
  const plan = account.planTier ?? account.planName;
  if (plan) return `套餐 ${plan}`;
  if (account.loginProvider) return `登录 ${account.loginProvider}`;
  if (account.status) return `状态 ${account.status}`;
  return '额度未知';
}

function accountStatusTone(status: string): MetricTone {
  const normalized = status.trim().toLowerCase();
  if (['active', 'valid', 'ok', 'enabled'].includes(normalized)) return 'success';
  if (['expired', 'revoked', 'disabled', 'error', 'failed'].includes(normalized)) return 'danger';
  if (['pending', 'warning', 'limited'].includes(normalized)) return 'warning';
  return 'muted';
}

function statusProgress(status: string): number {
  switch (accountStatusTone(status)) {
    case 'success':
      return 100;
    case 'warning':
      return 45;
    case 'danger':
      return 8;
    case 'normal':
    case 'muted':
    default:
      return 0;
  }
}
