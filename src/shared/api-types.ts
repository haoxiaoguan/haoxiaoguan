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
  terminalLaunchTemplate: string
  codexRelayInjectionEnabled: boolean
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

// ── Activity DTOs (activity context — 会话活动统计) ────────────────────────────
export interface ActivityTrendPointResponse {
  date: string
  value: number
}
// 仅返回本次入库的事件数；原设计的 scanned 字段已由单一 watermark 增量机制取代，故省略。
export interface ActivitySyncSummaryResponse {
  events: number
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
  totalCostUsd: number
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
  costUsd: number
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

// ── Sessions DTOs (sessions context — read-only on-disk AI CLI history) ──────
export type SessionToolDto = 'claude' | 'codex' | 'gemini'
export interface SessionSummaryDto {
  tool: SessionToolDto
  sessionId: string
  title?: string
  summary?: string
  projectDir?: string
  createdAt?: number
  lastActiveAt?: number
  sourcePath: string
  resumeCommand?: string
  provider?: string
  archived?: boolean
}
export interface SessionMessageDto {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts?: number
}
export interface ToolProbeDto {
  tool: SessionToolDto
  hasSessions: boolean
  count: number
  lastActiveAt?: number
}
export interface SessionPageDto {
  items: SessionSummaryDto[]
  total: number
  offset: number
}
export interface CodexProviderCountDto {
  provider: string
  count: number
}
export interface CodexRepairPreviewDto {
  available: boolean
  dbPath?: string
  currentProvider?: string
  counts: CodexProviderCountDto[]
  repairable: number
  codexRunning: boolean
}
export interface CodexRepairRequestDto {
  targetProvider: string
  fromProviders?: string[]
  rewriteRollout: boolean
}
export interface CodexRepairResultDto {
  updatedThreads: number
  userEventRows: number
  cwdRows: number
  globalStateKeys: number
  changedRollouts: number
  skippedRollouts: number
  backupId: string
}

export interface CodexRepairProgressDto {
  phase: 'scan' | 'backup' | 'rollout' | 'sqlite' | 'globalstate' | 'done'
  percent: number
  message: string
  current?: number
  total?: number
}

export interface SessionDeleteRequestDto {
  tool: SessionToolDto
  sourcePath: string
  sessionId: string
}
export interface SessionDeleteOutcomeDto {
  sourcePath: string
  ok: boolean
  error?: string
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
    /** Subscribe to the main-process periodic usage-sync completion. Returns an unsubscribe fn. */
    onUsageSynced(cb: () => void): () => void
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
    /** cpa 格式导出:返回脱敏前的完整 token JSON 字符串(1 个账号为对象,多个为数组)。 */
    exportAccountsCpa(accountIds: string[]): Promise<string>
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
  activity: {
    syncActivity(): Promise<ActivitySyncSummaryResponse>
    getActivityTrend(range: string, metric: string): Promise<ActivityTrendPointResponse[]>
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
    /** 拉取最近 N 条请求日志（G3）；省略 limit 返回环形缓冲全部。 */
    getRequestLog(limit?: number): Promise<ProxyRequestRecord[]>
    /** 清空请求日志环形缓冲（计数器保持单调，不影响 /metrics）。 */
    clearRequestLog(): Promise<void>
    /** 订阅请求日志推送（G3）。返回取消订阅函数。 */
    onRequestLog(cb: (record: ProxyRequestRecord) => void): () => void
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
  sessions: {
    probeTools(): Promise<ToolProbeDto[]>
    listSessions(tool: SessionToolDto, limit?: number, offset?: number): Promise<SessionPageDto>
    getMessages(tool: SessionToolDto, sourcePath: string): Promise<SessionMessageDto[]>
    deleteSession(tool: SessionToolDto, sourcePath: string, sessionId: string): Promise<void>
    deleteSessions(items: SessionDeleteRequestDto[]): Promise<SessionDeleteOutcomeDto[]>
    resume(command: string, cwd?: string): Promise<void>
    repairPreview(): Promise<CodexRepairPreviewDto>
    repair(req: CodexRepairRequestDto): Promise<CodexRepairResultDto>
    repairRollback(backupId: string): Promise<void>
    onRepairProgress(cb: (p: CodexRepairProgressDto) => void): () => void
  }
  updater: {
    /** 手动检查更新（dev 下 no-op）。 */
    check(): Promise<void>
    /** 手动触发下载（autoDownload 时通常已自动开始）。 */
    download(): Promise<void>
    /** 退出并安装已下载的更新。 */
    install(): Promise<void>
    /** 读取当前更新状态。 */
    getStatus(): Promise<UpdateStatus>
    /** 订阅更新状态推送。返回取消订阅函数。 */
    onStatus(cb: (status: UpdateStatus) => void): () => void
  }
  clientConfig: {
    /** 已支持客户端 + 检测状态。 */
    clients(): Promise<ClientConfigClientInfo[]>
    /** 列出接入档（省略 clientId 返回全部）。 */
    list(clientId?: ClientConfigClientId): Promise<ClientConfigProfileDto[]>
    create(input: CreateClientConfigProfileDto): Promise<ClientConfigProfileDto>
    update(id: string, patch: UpdateClientConfigProfileDto): Promise<void>
    delete(id: string): Promise<void>
    /** 预览将写入客户端配置的 before/after（不写盘）。 */
    preview(id: string): Promise<ClientConfigDiffFile[]>
    /** 用表单草稿值直接 dry-render 预览将写入的配置（不存档、不写盘）。 */
    previewDraft(input: ClientConfigDraftInput): Promise<ClientConfigDiffFile[]>
    /** 拉取供应商可用模型列表（GET /v1/models）。失败抛错。 */
    fetchModels(input: ClientConfigFetchModelsInput): Promise<string[]>
    /** 应用并设为当前生效（写客户端配置，写前自动快照）。 */
    apply(id: string): Promise<void>
    /** 从客户端配置移除本接入档（还原）。 */
    clear(id: string): Promise<void>
    /** 累加式:启用注入（与其它已启用档共存）。 */
    enable(id: string): Promise<void>
    /** 累加式:停用注入（仅移除该档）。 */
    disable(id: string): Promise<void>
    /** 累加式:设默认指针。 */
    setDefault(clientId: ClientConfigClientId, id: string): Promise<void>
    history(clientId: ClientConfigClientId): Promise<ClientConfigSnapshotDto[]>
    rollback(clientId: ClientConfigClientId, entryId: string): Promise<void>
    /** 一键接入本机反代：建 local-proxy 接入档并立即启用（读端口/签发 key/拉模型）。 */
    connectLocalProxy(clientId: ClientConfigClientId): Promise<ClientConfigProfileDto>
    /** 测连通（GET /v1/models）。 */
    testConnectivity(id: string): Promise<ClientConfigConnTest>
    /** Codex L2「中转注入」：开→注入单反代 provider(/v1)+写 model_catalog_json；关→清除。idempotent。 */
    setCodexRelayInjection(enabled: boolean): Promise<void>
    /** Codex L2 下切换第三方供应商启用态：标记 enabled + 重聚合(供/撤 relay、刷新 catalog)，不做 L1 注入。 */
    setCodexProviderEnabled(id: string, enabled: boolean): Promise<void>
  }
  shellOpen(target: string): Promise<void>
  getVersion(): Promise<string>
}

// ─── clientConfig DTO（与 main domain 同形）─────────────────────────────────
export type ClientConfigClientId = 'claude' | 'codex' | 'gemini_cli' | 'opencode' | 'openclaw' | 'hermes'
export type ClientConfigWriteMode = 'switch' | 'additive'
export interface ClientConfigClientInfo {
  clientId: ClientConfigClientId
  displayName: string
  detected: boolean
  writeMode: ClientConfigWriteMode
}
export interface ClientConfigProfileDto {
  id: string
  clientId: ClientConfigClientId
  name: string
  source: 'local-proxy' | 'manual'
  baseUrl: string
  model?: string
  settings?: Record<string, unknown>
  isCurrent: boolean
  enabled: boolean
  isDefault: boolean
  sortIndex: number
  createdAt: number
  updatedAt: number
  notes?: string
}
export interface ClientConfigDiffFile {
  file: string
  before: string | null
  after: string | null
}
export interface ClientConfigSnapshotDto {
  id: string
  clientId: ClientConfigClientId
  action: string
  tsMs: number
  profileId?: string
  files: Record<string, string | null>
}
export interface CreateClientConfigProfileDto {
  clientId: ClientConfigClientId
  name: string
  source: 'local-proxy' | 'manual'
  baseUrl: string
  model?: string
  settings?: Record<string, unknown>
  apiKey?: string
  keyRef?: string
  notes?: string
}
export interface UpdateClientConfigProfileDto {
  name?: string
  baseUrl?: string
  model?: string | null
  settings?: Record<string, unknown> | null
  apiKey?: string
  notes?: string | null
}
/** 配置预览草稿入参（表单值,不存档）。 */
export interface ClientConfigDraftInput {
  clientId: ClientConfigClientId
  name: string
  baseUrl: string
  apiKey?: string
  model?: string
  settings?: Record<string, unknown>
}
/** 拉取模型列表入参:apiKey 为空且给 profileId 时由后端解出已存档的 key。 */
export interface ClientConfigFetchModelsInput {
  clientId: ClientConfigClientId
  baseUrl: string
  apiKey?: string
  profileId?: string
}
export interface ClientConfigConnTest {
  ok: boolean
  status?: number
  message?: string
}

export interface WsStatus {
  running: boolean
  port?: number
  connectionCount: number
}

// 单条反代请求日志记录（G3）——与 main 的 ProxyRequestRecord 保持同形。
export interface ProxyRequestRecord {
  seq: number
  tsMs: number
  method: string
  path: string
  format: string
  platform?: string
  action: string
  stream: boolean
  status: number
  ok: boolean
  durationMs: number
  attempts: number
  accountId?: string
  clientKeyId?: string
  inputTokens?: number
  outputTokens?: number
  errorMessage?: string
}

// apiProxy 服务状态（与 main/contexts/apiProxy/application/api-proxy-service.ts
// 的 ApiProxyStatus 保持同形：state + 可选 port）。
export type ApiProxyState = 'stopped' | 'running' | 'failed'
export interface ApiProxyStatus {
  state: ApiProxyState
  port?: number
}

// 自动更新状态（G9）：主进程 autoUpdater 事件投影。
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
export interface UpdateStatus {
  state: UpdateState
  /** 可用 / 已下载的版本号。 */
  version?: string
  /** downloading 时的进度百分比（0–100）。 */
  percent?: number
  /** error 时的错误信息。 */
  error?: string
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
