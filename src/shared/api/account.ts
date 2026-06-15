// 账号 / 凭证 / 额度 DTO（account · credential · quota manifest §6）。

export interface AccountResponse {
  id: string
  platform: string
  email: string
  identityKey: string
  displayIdentifier: string
  name?: string | undefined
  loginProvider?: string | undefined
  planName?: string | undefined
  planTier?: string | undefined
  status?: string | undefined
  statusReason?: string | undefined
  profilePayload: unknown
  tags: string[]
  notes?: string | undefined
  isActive: boolean
  createdAt: string
  lastUsedAt?: string | undefined
}

export interface ImportAccountRequest {
  platform: string
  email: string
  token: string
  refreshToken?: string
  expiresAt?: string
  rawMetadata?: unknown
  name?: string
  tags: string[]
  notes?: string
}

export interface ImportResultResponse {
  imported: number
  skipped: number
  errors: string[]
}

export type CredentialValidationState =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'network_error'
  | 'unknown_error'
  | 'unsupported'
  | 'pending'

export interface CredentialValidationResult {
  state: CredentialValidationState
  checked_at: string
  details?: string
  expires_at?: string
}

export interface QuotaFetchResult {
  outcome: 'success' | 'unsupported' | 'stale' | 'failed'
  source: 'live' | 'cache' | 'none'
  freshness: 'fresh' | 'stale' | 'unknown'
  fetched_at: string
  models: Array<{ model_name: string; used: number; total: number; reset_at?: string }>
  error?: string
}

export interface HealthSnapshot {
  account_id: string
  validation: CredentialValidationResult
  quota?: QuotaFetchResult | undefined
  checked_at: string
}

// ── Credential DTOs (credential manifest §6) ─────────────────────────────────
export interface OAuthPending {
  pending_id: string
  authorize_url: string
  redirect_path: string
  bound_port?: number
}
export interface ImportedCredentialMaterial {
  provider: string
  email: string
  access_token: string
  refresh_token?: string
  expires_at?: string
  source: 'oauth' | 'local_scan' | 'token_json_file' | 'deep_link'
  raw_metadata?: unknown
}

// ── Quota DTOs (quota manifest §6) ───────────────────────────────────────────
export interface ModelQuotaResponse {
  modelName: string
  used: number
  total: number
  usagePercentage: number
  isWarning: boolean
  resetAt?: string
}
export interface QuotaResponse {
  accountId: string
  models: ModelQuotaResponse[]
  fetchedAt: string
}
export interface QuotaRefreshResultResponse {
  accountId: string
  success: boolean
  quota?: QuotaResponse
  error?: string
}
export type QuotaStatus = 'ok' | 'warning' | 'exhausted' | 'unknown' | 'unsupported' | 'error'
export type QuotaUnit = 'credits' | 'requests' | 'tokens' | 'usd' | 'percent' | 'none'
export type QuotaMetricKind =
  | 'usage'
  | 'remaining'
  | 'balance'
  | 'rate_limit'
  | 'entitlement'
  | 'credential'
export type QuotaWindow = 'minute' | 'hour' | 'day' | 'month' | 'billing_cycle'
export interface QuotaMetricResponse {
  key: string
  label: string
  kind: QuotaMetricKind
  unit: QuotaUnit
  used?: number
  total?: number
  remaining?: number
  percentUsed?: number
  percentRemaining?: number
  displayValue?: string
  window?: QuotaWindow
  resetAt?: string
  status: QuotaStatus
}
export interface AccountQuotaStateResponse {
  version: number
  status: QuotaStatus
  primaryMetricKey?: string
  metrics: QuotaMetricResponse[]
  fetchedAt?: string
  error?: string
  providerPayload: unknown
}
