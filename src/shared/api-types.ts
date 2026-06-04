// The typed surface exposed on window.api. Covers every IPC service namespace
// whose backing context is implemented (settings, system, agent, account,
// credential, quota, skill, usage, localBackup, mcp, sync) plus the
// version/shell helpers. The only renderer methods still on the throwing
// tauriInvoke shim are the websocket toggle/status pair (get_ws_status /
// toggle_ws), which belong to a websocket context not yet built.
export interface SettingsResponse {
  theme: string
  language: string
  closeBehavior: string
  wsPort: number
  refreshIntervals: Record<string, number>
  platformRefreshIntervals: Record<string, number>
  idePaths: Record<string, string>
  quotaRefreshConcurrency: number
  silentStart: boolean
  autostart: boolean
  utilityButtons: string
  allowStaleKiroImport: boolean
}
export interface AppDirs {
  dataDir: string
  configDir: string
  logDir: string
}
// Result of system.detectAppPath — auto-detected app/IDE path for a platform.
export interface AppPathInfo {
  /** First existing candidate on the current OS, or null if none found. */
  detected: string | null
  /** Representative placeholder path for the current platform+OS. */
  suggestion: string
}

// Per-platform outcome of account.detectActiveAccounts — which stored account
// each IDE is actually logged into (reverse-detected from local login state).
export interface ActiveDetectionResult {
  /** Frontend (kebab) platform id. */
  platform: string
  /** The account id now marked active for this platform, or null. */
  activeAccountId: string | null
  /** True when the detected local identity matched a stored account. */
  matched: boolean
}

// ── Agent DTO (agents manifest §6) ───────────────────────────────────────────
export interface AgentInfo {
  id: string
  displayName: string
  family: string
  capabilities: string[]
}

// ── Account DTOs (account manifest §6) ───────────────────────────────────────
export interface AccountResponse {
  id: string
  platform: string
  email: string
  identityKey: string
  displayIdentifier: string
  name?: string
  loginProvider?: string
  planName?: string
  planTier?: string
  status?: string
  statusReason?: string
  profilePayload: unknown
  tags: string[]
  notes?: string
  isActive: boolean
  createdAt: string
  lastUsedAt?: string
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
  quota?: QuotaFetchResult
  checked_at: string
}

// ── Skill DTOs (skill manifest §7) ───────────────────────────────────────────
export interface InstalledSkillDto {
  id: string
  name: string
  description?: string
  directory: string
  repo_owner?: string
  repo_name?: string
  repo_branch?: string
  readme_url?: string
  apps: Record<string, boolean>
  installed_at: number
  updated_at: number
  content_hash?: string
  ssot_path: string
  storage_location: string
}

export interface DiscoverableSkillDto {
  name: string
  description?: string
  directory: string
  repo_owner: string
  repo_name: string
  repo_branch: string
  readme_url?: string
  metadata?: { author?: string; version?: string; tags: string[] }
}

export interface SkillBackupEntryDto {
  backup_id: string
  skill_id: string
  snapshot_json: string
  archive_path: string
  created_at: number
}

export interface SkillRepoDto {
  owner: string
  name: string
  branch: string
  enabled: boolean
  sort_order: number
  added_at: number
}

export interface UnmanagedSkillEntryDto {
  dir_name: string
  path: string
  description?: string
}

// ── Usage DTOs (usage manifest §6) ───────────────────────────────────────────
export interface UsageSyncSummaryResponse {
  imported: number
  failed: number
  platforms: string[]
}
export interface UsageSummaryResponse {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  lastSyncedAt: number | null
}
export interface UsageTrendPointResponse {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
}
export interface PlatformUsageBreakdownResponse {
  platform: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  requests: number
  shareRatio: number
}
export interface UsageSyncStatusResponse {
  supportedPlatforms: string[]
  pendingPlatforms: string[]
  failedPlatforms: string[]
  lastSyncedAt: number | null
  healthStatus: string
}

// ── LocalBackup DTOs (localBackup manifest §6) ───────────────────────────────
export interface BackupEntryDto {
  filename: string
  sizeBytes: number
  createdAt: number
}
export interface LocalBackupConfigDto {
  intervalHours: number
  retainCount: number
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

// ── MCP DTOs (mcp manifest §7) ───────────────────────────────────────────────
export interface McpServerSpec {
  transport: 'stdio' | 'http' | 'sse'
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
}
export interface McpServerDto {
  id: string
  name: string
  description: string | null
  spec: McpServerSpec
  apps: Record<string, boolean>
  homepage: string | null
  docs: string | null
  tags: string[]
  created_at: number
  updated_at: number
  sort_order: number
}
export interface UnmanagedMcpEntryDto {
  id: string
  name: string
  spec: McpServerSpec
  found_in: string[]
}
export interface UpsertMcpServerRequest {
  id?: string
  name: string
  description?: string | null
  transport: 'stdio' | 'http' | 'sse'
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  url?: string | null
  apps?: Record<string, boolean>
  homepage?: string | null
  docs?: string | null
  tags?: string[]
}
export interface ToggleMcpAppRequest {
  server_id: string
  agent_id: string
  enabled: boolean
}
export interface ImportSelectedMcpRequest {
  selections: Array<{ server_id: string; agent_ids: string[] }>
}

// ── Sync DTOs (sync manifest §7) ─────────────────────────────────────────────
export interface WebdavStatus {
  lastSyncAt?: number | null
  lastError?: string | null
  lastErrorSource?: string | null
  lastRemoteEtag?: string | null
}
export interface WebdavConfig {
  enabled: boolean
  baseUrl: string
  username: string
  remoteRoot: string
  profile: string
  autoSync: boolean
  status: WebdavStatus
}
export interface RemoteInfo {
  empty: boolean
  deviceName?: string
  createdAt?: number
  version?: number
  compatible: boolean
}
export interface DownloadResult {
  status: string
  needsRestart: boolean
}
export interface TestConnectionArgs {
  config: WebdavConfig
  password?: string
  passwordTouched: boolean
}
export interface SaveConfigArgs {
  config: WebdavConfig
  password?: string
  passwordTouched: boolean
  syncPassword?: string
  syncPasswordTouched: boolean
}

export interface HxgApi {
  settings: {
    getSettings(): Promise<SettingsResponse>
    updateSettings(req: { settings: Record<string, string> }): Promise<void>
    setAutostart(enabled: boolean): Promise<void>
  }
  system: {
    getAppDirs(): Promise<AppDirs>
    /** Native open-file dialog; resolves to the chosen path or null on cancel. */
    pickPath(): Promise<string | null>
    /** Auto-detect the app/IDE install path for a platform on the current OS. */
    detectAppPath(platform: string): Promise<AppPathInfo>
    /** Subscribe to background quota-refresh events. Returns an unsubscribe fn. */
    onQuotaUpdated(cb: (accountIds: string[]) => void): () => void
  }
  agent: {
    listAgents(): Promise<AgentInfo[]>
    getAgentInfo(args: { agentId: string }): Promise<AgentInfo>
    listAgentsByCapability(args: { capability: string }): Promise<AgentInfo[]>
    getAgentCapabilities(args: { agentId: string }): Promise<string[]>
  }
  account: {
    importAccount(req: ImportAccountRequest): Promise<AccountResponse>
    switchAccount(accountId: string): Promise<void>
    deleteAccount(accountId: string): Promise<void>
    batchDelete(accountIds: string[]): Promise<{ deletedCount: number }>
    filterAccounts(filter: { platform?: string; tags?: string[] }): Promise<AccountResponse[]>
    getAccountsByPlatform(platform: string): Promise<AccountResponse[]>
    switchAccountV2(args: {
      accountId: string
      launchOnSwitch?: boolean
      executableOverride?: string
    }): Promise<void>
    exportAccounts(req: { accountIds: string[]; includeCredentials: boolean }): Promise<string>
    importAccounts(req: {
      data: string
      conflictStrategy: 'skip' | 'overwrite' | 'keep_both'
    }): Promise<ImportResultResponse>
    updateAccount(
      accountId: string,
      patch: { name?: string | null; tags?: string[]; notes?: string | null },
    ): Promise<AccountResponse>
    reauthenticate(
      accountId: string,
      input: {
        identifier: string
        token: string
        refreshToken?: string
        expiresAt?: string
        rawMetadata?: unknown
      },
    ): Promise<AccountResponse>
    validateCredential(accountId: string): Promise<CredentialValidationResult>
    getAccountHealth(accountId: string): Promise<HealthSnapshot>
    validateBatch(
      accountIds: string[],
      concurrency: number,
    ): Promise<
      Array<
        | { account_id: string; result: CredentialValidationResult }
        | { account_id: string; error: string }
      >
    >
    detectActiveAccounts(): Promise<ActiveDetectionResult[]>
  }
  credential: {
    startOauth(provider: string, mode: string): Promise<OAuthPending>
    completeOauth(
      pendingId: string,
      code: string,
      proxyId?: string,
      accountId?: string,
    ): Promise<ImportedCredentialMaterial>
    importTokenJson(provider: string, payload: string, proxyId?: string): Promise<ImportedCredentialMaterial>
    scanLocalCredentials(provider: string, proxyId?: string): Promise<ImportedCredentialMaterial[]>
    importDeeplink(provider: string, url: string, proxyId?: string): Promise<ImportedCredentialMaterial>
    validateCredential(accountId: string): Promise<CredentialValidationResult>
    validateBatch(
      accountIds: string[],
      concurrency: number,
    ): Promise<
      Array<
        | { account_id: string; result: CredentialValidationResult }
        | { account_id: string; error: string }
      >
    >
  }
  quota: {
    refreshQuota(args: { accountId: string }): Promise<QuotaResponse>
    refreshAllQuotas(): Promise<QuotaRefreshResultResponse[]>
    getQuota(args: { accountId: string }): Promise<QuotaResponse>
    getQuotaState(args: { accountId: string }): Promise<AccountQuotaStateResponse>
    refreshQuotaState(args: { accountId: string }): Promise<AccountQuotaStateResponse>
  }
  skill: {
    getInstalledSkills(): Promise<InstalledSkillDto[]>
    installSkillUnified(req: {
      name: string
      description?: string
      directory: string
      repo_owner: string
      repo_name: string
      repo_branch: string
      readme_url?: string
      agent_id: string
    }): Promise<InstalledSkillDto>
    uninstallSkillUnified(skillId: string): Promise<{ removed_from_agents: string[] }>
    toggleSkillApp(req: { skill_id: string; agent_id: string; enabled: boolean }): Promise<boolean>
    updateSkill(skillId: string): Promise<InstalledSkillDto>
    checkSkillUpdates(skillId: string): Promise<{ has_update: boolean }>
    getSkillBackups(): Promise<SkillBackupEntryDto[]>
    deleteSkillBackup(backupId: string): Promise<void>
    restoreSkillBackup(backupId: string): Promise<InstalledSkillDto>
    discoverAvailableSkills(): Promise<DiscoverableSkillDto[]>
    searchSkillsSh(req: { query: string; limit?: number; offset?: number }): Promise<
      DiscoverableSkillDto[]
    >
    getSkillRepos(): Promise<SkillRepoDto[]>
    addSkillRepo(req: { owner: string; name: string; branch: string }): Promise<void>
    removeSkillRepo(req: { owner: string; name: string }): Promise<void>
    scanUnmanagedSkills(agentId: string): Promise<UnmanagedSkillEntryDto[]>
    importSkillsFromApps(req: { agent_id: string; dir_names: string[] }): Promise<
      InstalledSkillDto[]
    >
    openZipFileDialog(): Promise<string | null>
    installSkillsFromZip(zipPath: string): Promise<InstalledSkillDto[]>
    migrateSkillStorage(skillId: string, target: string): Promise<void>
    getSkillStorageLocation(): Promise<string>
    setSkillStorageLocation(location: string): Promise<void>
    getSkillSyncMethod(): Promise<string>
    setSkillSyncMethod(method: string): Promise<void>
  }
  usage: {
    syncUsageSources(): Promise<UsageSyncSummaryResponse>
    getUsageSummary(range: string): Promise<UsageSummaryResponse>
    getUsageTrend(range: string, metric: string): Promise<UsageTrendPointResponse[]>
    getUsagePlatformBreakdown(range: string): Promise<PlatformUsageBreakdownResponse[]>
    getUsageSyncStatus(): Promise<UsageSyncStatusResponse>
  }
  localBackup: {
    create(): Promise<BackupEntryDto>
    list(): Promise<BackupEntryDto[]>
    restore(filename: string): Promise<string>
    delete(filename: string): Promise<void>
    rename(arg: { old_filename: string; new_name: string }): Promise<BackupEntryDto>
    getConfig(): Promise<LocalBackupConfigDto>
    saveConfig(config: LocalBackupConfigDto): Promise<void>
  }
  mcp: {
    getMcpServers(): Promise<McpServerDto[]>
    upsertMcpServer(request: UpsertMcpServerRequest): Promise<McpServerDto>
    deleteMcpServer(server_id: string): Promise<boolean>
    toggleMcpApp(request: ToggleMcpAppRequest): Promise<void>
    importMcpFromApps(): Promise<{ imported_count: number }>
    validateMcpCommand(command: string): Promise<{ valid: boolean }>
    getClaudeMcpStatus(): Promise<
      Record<string, { server_count: number; config_exists: boolean; config_path: string }>
    >
    readAgentMcpConfig(agent_id: string): Promise<Record<string, McpServerSpec>>
    scanUnmanagedMcp(): Promise<UnmanagedMcpEntryDto[]>
    importSelectedMcp(request: ImportSelectedMcpRequest): Promise<{ imported_count: number }>
  }
  sync: {
    getConfig(): Promise<WebdavConfig>
    testConnection(args: TestConnectionArgs): Promise<{ success: boolean }>
    saveConfig(args: SaveConfigArgs): Promise<void>
    syncUpload(): Promise<{ status: 'uploaded' }>
    syncDownload(): Promise<DownloadResult>
    fetchRemoteInfo(): Promise<RemoteInfo>
  }
  ws: {
    getWsStatus(): Promise<WsStatus>
    toggleWs(enabled: boolean): Promise<void>
  }
  proxy: {
    listProxies(): Promise<ProxyDto[]>
    createProxy(req: CreateProxyRequest): Promise<ProxyDto>
    updateProxy(id: string, patch: UpdateProxyRequest): Promise<ProxyDto>
    deleteProxy(id: string): Promise<void>
    importProxies(text: string): Promise<ProxyImportSummary>
    testProxy(id: string): Promise<ProxyTestResultDto>
    testProxies(ids: string[], concurrency?: number): Promise<ProxyTestResultDto[]>
    listBindings(): Promise<AccountBindingDto[]>
    getAccountBinding(accountId: string): Promise<AccountBindingDto | null>
    bindAccountToProxy(accountId: string, proxyId: string): Promise<void>
    unbindAccount(accountId: string): Promise<void>
  }
  apiProxy: {
    /** 启动本地反代服务；resolve 启动后的最新状态。 */
    start(): Promise<ApiProxyStatus>
    /** 停止本地反代服务；resolve 停止后的最新状态。 */
    stop(): Promise<ApiProxyStatus>
    /** 读取当前服务状态（state + 可选已绑定端口）。 */
    getStatus(): Promise<ApiProxyStatus>
    /** 手动解除账号挂起：清运行态 + 持久化 status。 */
    clearAccountSuspension(accountId: string): Promise<void>
    /** 创建客户端 Key（明文仅此次回显）。 */
    createClientKey(name: string): Promise<{ meta: ApiProxyKeyMeta; plaintext: string }>
    /** 列出所有客户端 Key 元信息（不含明文）。 */
    listClientKeys(): Promise<ApiProxyKeyMeta[]>
    /** 启用/禁用客户端 Key。 */
    setClientKeyActive(id: string, isActive: boolean): Promise<void>
    /** 删除客户端 Key。 */
    deleteClientKey(id: string): Promise<void>
    /** 查询账号池运行态健康（合并持久化 meta + 内存运行态）。 */
    getAccountPoolHealth(): Promise<AccountPoolHealthRow[]>
  }
  accountGroup: {
    listGroups(): Promise<AccountGroupDto[]>
    createGroup(req: CreateAccountGroupRequest): Promise<AccountGroupDto>
    updateGroup(id: string, patch: UpdateAccountGroupRequest): Promise<AccountGroupDto>
    deleteGroup(id: string, force?: boolean): Promise<void>
    listMembers(groupId: string): Promise<AccountGroupMembershipDto[]>
    listGroupsForAccount(accountId: string): Promise<AccountGroupDto[]>
    addMembers(groupId: string, accountIds: string[]): Promise<{ added: number }>
    removeMembers(groupId: string, accountIds: string[]): Promise<{ removed: number }>
    bindGroupToProxy(groupId: string, proxyId: string): Promise<AccountGroupBindingDto>
    unbindGroup(groupId: string): Promise<void>
    getGroupBinding(groupId: string): Promise<AccountGroupBindingDto | null>
  }
  shellOpen(target: string): Promise<void>
  getVersion(): Promise<string>
}

export interface WsStatus {
  running: boolean
  port?: number
  connectionCount: number
}

// apiProxy 服务状态（与 main/contexts/apiProxy/application/api-proxy-service.ts
// 的 ApiProxyStatus 保持同形：state + 可选 port）。
export type ApiProxyState = 'stopped' | 'running' | 'failed'
export interface ApiProxyStatus {
  state: ApiProxyState
  port?: number
}

// 账号池健康行（IPC 返回）：合并账号 meta + 运行态快照。
export interface AccountPoolHealthRow {
  accountId: string
  email: string
  status?: string
  runtimeState: 'available' | 'cooldown' | 'quota_exhausted' | 'suspended'
  failureCount: number
  cooldownUntilMs?: number
  quotaExhaustedAtMs?: number
  /** quota_exhausted 恢复时间戳（ms）：由服务端按配置值计算，前端直接展示。 */
  quotaResetsAtMs?: number
}

// 客户端 Key 元信息（不含明文/密文）。
export interface ApiProxyKeyMeta {
  id: string
  name: string
  keyPrefix: string
  isActive: boolean
  createdAt: string
}

// ── Proxy DTOs (proxy context — outbound proxy IP management) ─────────────────
export type ProxyProtocolDto = 'http' | 'https' | 'socks5'
export type ProxyStatusDto = 'unknown' | 'ok' | 'failed'

/** A proxy as seen by the renderer — never carries the plaintext password. */
export interface ProxyDto {
  id: string
  label?: string
  protocol: ProxyProtocolDto
  host: string
  port: number
  username?: string
  passwordSet: boolean
  status: ProxyStatusDto
  lastEgressIp?: string
  lastLatencyMs?: number
  lastCheckedAt?: string
  lastError?: string
  tags: string[]
  displayUrl: string
  boundAccountCount: number
  createdAt: string
}
export interface AccountBindingDto {
  accountId: string
  proxyId?: string
}
export interface ProxyImportSummary {
  imported: number
  skipped: number
  failed: Array<{ lineNumber: number; raw: string; error: string }>
}
export interface ProxyTestResultDto {
  proxyId: string
  status: 'ok' | 'failed'
  egressIp?: string
  latencyMs?: number
  error?: string
  checkedAt: string
}
export interface CreateProxyRequest {
  label?: string
  protocol: ProxyProtocolDto
  host: string
  port: number
  username?: string
  password?: string
  tags?: string[]
}
export interface UpdateProxyRequest {
  label?: string
  protocol?: ProxyProtocolDto
  host?: string
  port?: number
  username?: string
  password?: string | null
  tags?: string[]
}

// ── AccountGroup DTOs (account-group context) ────────────────────────────────
export interface AccountGroupBindingDto {
  groupId: string
  proxyId?: string
}
export interface AccountGroupDto {
  id: string
  name: string
  color?: string
  description?: string
  memberCount: number
  proxyBinding?: AccountGroupBindingDto
  createdAt: string
  updatedAt: string
}
export interface AccountGroupMembershipDto {
  groupId: string
  accountId: string
  createdAt: string
}
export interface CreateAccountGroupRequest {
  name: string
  color?: string
  description?: string
}
export interface UpdateAccountGroupRequest {
  name?: string
  color?: string | null
  description?: string | null
}

declare global {
  interface Window {
    api: HxgApi
  }
}
