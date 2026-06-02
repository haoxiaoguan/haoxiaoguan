// TypeScript type definitions matching the Rust DTOs

export type AgentId =
  | 'cursor'
  | 'windsurf'
  | 'antigravity'
  | 'kiro'
  | 'github-copilot'
  | 'codex'
  | 'gemini-cli'
  | 'codebuddy'
  | 'codebuddy-cn'
  | 'qoder'
  | 'trae'
  | 'zed'
  | 'claude'
  | 'claude-desktop'
  | 'gemini'
  | 'opencode'
  | 'hermes';

/** @deprecated Use AgentId instead */
export type PlatformId = AgentId;

export type IdeFamily = 'vscode' | 'jetbrains' | 'standalone';

export type ImportMethod = 'oauth' | 'token_json' | 'local_credential';

export type ThemeMode = 'light' | 'dark' | 'system';

export type CloseWindowBehavior = 'quit' | 'minimize';

// ============================================================================
// Account Types
// ============================================================================

export interface Account {
  id: string;
  platform: AgentId;
  email: string;
  identityKey: string;
  displayIdentifier: string;
  name?: string;
  loginProvider?: string;
  planName?: string;
  planTier?: string;
  status?: string;
  statusReason?: string;
  profilePayload: unknown;
  tags: string[];
  notes?: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ImportAccountRequest {
  platform: string;
  email: string;
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  rawMetadata?: unknown;
  name?: string;
  tags: string[];
  notes?: string;
}

export interface FilterAccountsRequest {
  platform?: string;
  tags?: string[];
}

export interface BatchDeleteRequest {
  accountIds: string[];
}

export interface BatchDeleteResponse {
  deletedCount: number;
}

// ============================================================================
// Quota Types
// ============================================================================

export interface ModelQuota {
  modelName: string;
  used: number;
  total: number;
  usagePercentage: number;
  isWarning: boolean;
  resetAt?: string;
}

export interface QuotaInfo {
  accountId: string;
  models: ModelQuota[];
  fetchedAt: string;
}

export type QuotaStatus =
  | 'ok'
  | 'warning'
  | 'exhausted'
  | 'unknown'
  | 'unsupported'
  | 'error';

export type QuotaUnit =
  | 'credits'
  | 'requests'
  | 'tokens'
  | 'usd'
  | 'percent'
  | 'none';

export type QuotaMetricKind =
  | 'usage'
  | 'remaining'
  | 'balance'
  | 'rate_limit'
  | 'entitlement'
  | 'credential';

export type QuotaWindow =
  | 'minute'
  | 'hour'
  | 'day'
  | 'month'
  | 'billing_cycle';

export interface QuotaMetric {
  key: string;
  label: string;
  kind: QuotaMetricKind;
  unit: QuotaUnit;
  used?: number;
  total?: number;
  remaining?: number;
  percentUsed?: number;
  percentRemaining?: number;
  displayValue?: string;
  window?: QuotaWindow;
  resetAt?: string;
  status: QuotaStatus;
}

export interface AccountQuotaState {
  version: 1;
  status: QuotaStatus;
  primaryMetricKey?: string;
  metrics: QuotaMetric[];
  fetchedAt?: string;
  error?: string;
  providerPayload: unknown;
}

export interface QuotaRefreshResult {
  accountId: string;
  success: boolean;
  quota?: QuotaInfo;
  error?: string;
}

// ============================================================================
// Usage Types
// ============================================================================

export interface UsageSyncSummaryResponse {
  imported: number;
  failed: number;
  platforms: string[];
}

export interface UsageSummaryResponse {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
  lastSyncedAt?: number;
}

export interface UsageTrendPointResponse {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
}

export interface PlatformUsageBreakdownResponse {
  platform: AgentId | string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requests: number;
  shareRatio: number;
}

export interface UsageSyncStatusResponse {
  supportedPlatforms: string[];
  pendingPlatforms: string[];
  failedPlatforms: string[];
  lastSyncedAt?: number;
  healthStatus: 'healthy' | 'warning' | 'error' | 'pending';
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Settings {
  theme: ThemeMode;
  language: string;
  closeBehavior: CloseWindowBehavior;
  wsPort: number;
  refreshIntervals: Record<string, number>;
  platformRefreshIntervals: Record<string, number>;
  idePaths: Record<string, string>;
  silentStart: boolean;
  autostart: boolean;
  utilityButtons: string;
  allowStaleKiroImport: boolean;
}

export interface UpdateSettingsRequest {
  settings: Record<string, string>;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export interface WsStatus {
  running: boolean;
  port?: number;
  connectionCount: number;
}

/** 应用关键目录路径（关于页展示用）。 */
export interface AppDirs {
  dataDir: string;
  configDir: string;
  logDir: string;
}

export interface AppPathInfo {
  detected: string | null;
  suggestion: string;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentInfo {
  id: string;
  displayName: string;
  family: string;
  capabilities: string[];
}

export interface PlatformCapabilities {
  family: IdeFamily;
  supportsMultiInstance: boolean;
  supportsAutoLaunch: boolean;
  supportsExtensionInjection: boolean;
  supportedImportMethods: ImportMethod[];
  customActions: PlatformAction[];
}

export interface PlatformAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** @deprecated Use AgentInfo instead */
export interface PlatformInfo {
  id: AgentId;
  displayName: string;
  family: IdeFamily;
  capabilities: PlatformCapabilities;
}

// ============================================================================
// Switch History Types
// ============================================================================

export interface SwitchRecord {
  id: number;
  accountId: string;
  platform: string;
  triggerType: 'manual' | 'auto' | 'websocket';
  success: boolean;
  errorMessage?: string;
  switchedAt: string;
}

// ============================================================================
// Export/Import Types
// ============================================================================

export interface ExportData {
  version: string;
  exported_at: string;
  accounts: ExportAccount[];
}

export interface ExportAccount {
  id: string;
  platform: string;
  email: string;
  name?: string;
  tags: string[];
  notes?: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
  credential?: ExportCredential;
}

export interface ExportCredential {
  token: string;
  refresh_token?: string;
}

export interface ExportAccountsRequest {
  accountIds: string[];
  includeCredentials: boolean;
}

export interface ImportAccountsRequest {
  data: string;
  conflictStrategy: 'skip' | 'overwrite' | 'keep_both';
}

export interface ImportResultResponse {
  imported: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// Skill Types
// ============================================================================

export interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repo_owner?: string;
  repo_name?: string;
  repo_branch?: string;
  readme_url?: string;
  apps: Record<string, boolean>;
  installed_at: number;
  updated_at: number;
  content_hash?: string;
  ssot_path: string;
  storage_location: string;
}

export interface DiscoverableSkill {
  name: string;
  description?: string;
  directory: string;
  repo_owner: string;
  repo_name: string;
  repo_branch: string;
  readme_url?: string;
  metadata?: SkillMetadata;
}

export interface SkillMetadata {
  author?: string;
  version?: string;
  tags: string[];
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
  sort_order: number;
  added_at: number;
}

export interface SkillBackupEntry {
  backup_id: string;
  skill_id: string;
  snapshot_json: string;
  archive_path: string;
  created_at: number;
}

/** 本地 DB 快照条目（local_backup_list 返回）。 */
export interface LocalBackupEntry {
  filename: string;
  sizeBytes: number;
  createdAt: number;
}

/** 本地备份配置（local_backup_get_config 返回）。 */
export interface LocalBackupConfig {
  intervalHours: number;
  retainCount: number;
}

export interface UnmanagedSkillEntry {
  dir_name: string;
  path: string;
}

export interface SkillUpdateCheckResult {
  has_update: boolean;
}

export type SyncMethod = 'auto' | 'symlink' | 'copy';
export type StorageLocation = 'haoxiaoguan' | 'agent';

// ============================================================================
// MCP Types
// ============================================================================

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServerSpec {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpServer {
  id: string;
  name: string;
  description?: string;
  spec: McpServerSpec;
  apps: Record<string, boolean>;
  homepage?: string;
  docs?: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  sort_order: number;
}

export interface UpsertMcpServerRequest {
  id?: string;
  name: string;
  description?: string;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  apps?: Record<string, boolean>;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

export interface ImportMcpResult {
  imported_count: number;
}

export interface UnmanagedMcpEntry {
  id: string;
  name: string;
  spec: McpServerSpec;
  /** 出现在哪些 agent 的配置文件里（agent id 字符串） */
  found_in: string[];
}

export interface ValidateCommandResult {
  valid: boolean;
}

// ============================================================================
// WebDAV Sync (2c 后端契约，camelCase 对齐 serde rename_all)
// ============================================================================

/** WebDAV 同步状态（后端维护，前端只读）。 */
export interface WebdavStatus {
  lastSyncAt?: number | null;
  lastError?: string | null;
  /** "manual" | "auto"；前端仅在 "auto" 时红框提示。 */
  lastErrorSource?: string | null;
  lastRemoteEtag?: string | null;
}

/** WebDAV 同步配置（不含密码；密码存 keychain）。 */
export interface WebdavConfig {
  enabled: boolean;
  baseUrl: string;
  username: string;
  remoteRoot: string;
  profile: string;
  autoSync: boolean;
  status: WebdavStatus;
}

/** 远端 manifest 概览（fetchRemoteInfo 返回）。 */
export interface RemoteInfo {
  empty: boolean;
  deviceName?: string;
  createdAt?: number;
  version?: number;
  compatible: boolean;
}

/** 下载结果（needsRestart：换设备恢复后需重启加载新密钥）。 */
export interface DownloadResult {
  status: string;
  needsRestart: boolean;
}
