import type { Account } from '../../types';

export interface CodexSubscriptionInfo {
  tone: 'active' | 'warning' | 'expired' | 'missing';
  valueText: string;
  detailText?: string;
}

/**
 * 登录方式标签：实体 loginProvider 优先；为空时按平台/payload 推断。
 * codex 不再一律标「API Key」——旧导入路径（cpa/卡密）不带 auth_mode，实体列为空，
 * 但 payload 里的 authMode / OAuth 痕迹（accountId/id_token）足以区分。
 */
export function loginMethodLabel(account: Account): string {
  if (account.loginProvider) return account.loginProvider;
  if (account.platform === 'github-copilot') return 'GitHub 登录';
  if (account.platform === 'cursor' || account.platform === 'gemini-cli') return 'Google 登录';
  if (account.platform === 'codex') return codexLoginFallback(account);
  if (account.identityKey.toLowerCase().includes('api')) return 'API Key';
  return '设备登录';
}

function codexLoginFallback(account: Account): string {
  const payload = toRecord(account.profilePayload);
  const authMode = readString(payload, 'authMode') || readString(payload, 'auth_mode');
  if (authMode) {
    const m = authMode.toLowerCase();
    return m === 'api_key' || m === 'apikey' ? 'API Key' : authMode;
  }
  const oauthHint =
    readString(payload, 'accountId') ||
    readString(payload, 'account_id') ||
    readString(payload, 'id_token');
  if (oauthHint) return 'chatgpt_oauth';
  return 'API Key';
}

export function accountPlanLabel(account: Account): string {
  if (account.platform === 'codex') return codexPlanLabel(account);
  // Kiro's planTier is an internal AWS code (e.g. Q_DEVELOPER_STANDALONE_PRO_PLUS);
  // planName is the human title (e.g. KIRO PRO+). Prefer the readable name.
  if (account.platform === 'kiro') return account.planName || account.planTier || 'Free';
  return account.planTier || account.planName || 'Free';
}

export function codexSubscriptionInfo(account: Account): CodexSubscriptionInfo | undefined {
  if (account.platform !== 'codex') return undefined;
  const payload = toRecord(account.profilePayload);
  const planType =
    readString(payload, 'planType') ||
    readString(payload, 'plan_type') ||
    account.planTier ||
    account.planName;
  const planKey = normalizeCodexPlanKey(planType);
  if (isCodexNewApiAccount(account, payload) || planKey === 'free' || planKey === 'api_key') {
    return undefined;
  }

  const rawDate =
    readScalarString(payload, 'subscriptionActiveUntil') ||
    readScalarString(payload, 'subscription_active_until');
  const date = parseCodexSubscriptionDate(rawDate);
  if (!date) {
    return {
      tone: 'missing',
      valueText: '有效期未知',
    };
  }

  const diffMs = date.getTime() - Date.now();
  const detailText = formatDateTime(date);
  if (diffMs <= 0) {
    return {
      tone: 'expired',
      valueText: '已过期',
      detailText,
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.ceil(diffMs / hourMs));
    return {
      tone: 'warning',
      valueText: `${hours} 小时后到期`,
      detailText,
    };
  }

  const days = Math.ceil(diffMs / dayMs);
  return {
    tone: days <= 7 ? 'warning' : 'active',
    valueText: days > 99 ? '99+ 天后到期' : `${days} 天后到期`,
    detailText,
  };
}

function codexPlanLabel(account: Account): string {
  const payload = toRecord(account.profilePayload);
  const planType =
    readString(payload, 'planType') ||
    readString(payload, 'plan_type') ||
    account.planTier ||
    account.planName;

  if (isCodexNewApiAccount(account, payload)) {
    return planType?.trim() || 'Cockpit Api';
  }

  const baseLabel = codexPlanDisplayName(planType);
  if (normalizeCodexPlanKey(planType) !== 'pro') return baseLabel;

  const authFilePlanType =
    normalizeCodexAuthFilePlanType(readString(payload, 'authFilePlanType')) ??
    normalizeCodexAuthFilePlanType(readString(payload, 'auth_file_plan_type')) ??
    normalizeCodexAuthFilePlanType(planType);

  return authFilePlanType === 'prolite' ? `${baseLabel} 5x` : `${baseLabel} 20x`;
}

function isCodexNewApiAccount(account: Account, payload: Record<string, unknown> | null): boolean {
  const authMode = readString(payload, 'authMode') || readString(payload, 'auth_mode') || account.loginProvider;
  const providerId = (
    readString(payload, 'apiProviderId') || readString(payload, 'api_provider_id')
  )?.toLowerCase() ?? '';
  const apiBaseUrl = readString(payload, 'apiBaseUrl') || readString(payload, 'api_base_url');
  const planType = (
    readString(payload, 'planType') ||
    readString(payload, 'plan_type') ||
    account.planTier ||
    account.planName ||
    ''
  ).toUpperCase();

  return (
    authMode?.trim().toLowerCase() === 'apikey' &&
    (providerId === 'cockpit_api' ||
      providerId === 'new_api' ||
      isCockpitApiBaseUrl(apiBaseUrl) ||
      planType === 'COCKPIT API' ||
      planType === 'NEW_API_EXCLUSIVE')
  );
}

function codexPlanDisplayName(planType?: string): string {
  if (!planType) return 'FREE';
  const upper = planType.toUpperCase();
  if (upper.includes('TEAM')) return 'TEAM';
  if (upper.includes('ENTERPRISE')) return 'ENTERPRISE';
  if (upper.includes('PLUS')) return 'PLUS';
  if (upper.includes('PRO')) return 'PRO';
  return upper;
}

function normalizeCodexPlanKey(planType?: string): string {
  const normalized = planType?.trim().toLowerCase() ?? '';
  if (!normalized) return 'free';
  if (normalized.includes('api')) return 'api_key';
  if (normalized.includes('enterprise')) return 'enterprise';
  if (normalized.includes('business')) return 'business';
  if (normalized.includes('team')) return 'team';
  if (normalized.includes('edu')) return 'edu';
  if (normalized.includes('go')) return 'go';
  if (normalized.includes('plus')) return 'plus';
  if (normalized.includes('pro')) return 'pro';
  if (normalized.includes('free')) return 'free';
  return normalized;
}

function normalizeCodexAuthFilePlanType(value?: string): 'prolite' | 'promax' | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[_\s]+/g, '-') ?? '';
  if (
    normalized === 'prolite' ||
    normalized === 'pro-lite' ||
    normalized === 'pro-5x' ||
    normalized === 'codex-pro-5x'
  ) {
    return 'prolite';
  }
  if (
    normalized === 'promax' ||
    normalized === 'pro-max' ||
    normalized === 'pro-20x' ||
    normalized === 'codex-pro-20x'
  ) {
    return 'promax';
  }
  return undefined;
}

function isCockpitApiBaseUrl(value?: string): boolean {
  return normalizeApiBaseUrl(value) === normalizeApiBaseUrl('https://chongcodex.cn/v1');
}

function normalizeApiBaseUrl(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

function parseCodexSubscriptionDate(value?: string): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    let timestamp = Number(trimmed);
    if (!Number.isFinite(timestamp)) return null;
    if (timestamp < 1_000_000_000_000) timestamp *= 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readScalarString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
