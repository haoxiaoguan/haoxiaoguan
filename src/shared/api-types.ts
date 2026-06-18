// 渲染层 window.api 的类型入口。DTO 按域拆分到 ./api/*（见各文件），此处统一
// re-export 以保持 `@shared/api-types` / `../shared/api-types` 导入路径不变，并定义
// 覆盖所有 IPC 服务命名空间的契约接口 HxgApi（settings/system/agent/account/
// credential/quota/skill/usage/activity/localBackup/mcp/sync/ws/proxy/apiProxy/
// accountGroup/sessions/updater/clientConfig + version/shell/window 助手）。

export * from './api/common'
export * from './api/account'
export * from './api/skill'
export * from './api/usage'
export * from './api/integrations'
export * from './api/routing'

import type {
  SettingsResponse,
  AppDirs,
  AppPathInfo,
  AgentInfo,
  ActiveDetectionResult,
  TimeWindowDto,
  TrendGranularityDto,
} from './api/common'
import type {
  AccountResponse,
  ImportAccountRequest,
  ImportResultResponse,
  CredentialValidationResult,
  HealthSnapshot,
  OAuthPending,
  ImportedCredentialMaterial,
  QuotaResponse,
  QuotaRefreshResultResponse,
  AccountQuotaStateResponse,
} from './api/account'
import type {
  InstalledSkillDto,
  SkillBackupEntryDto,
  DiscoverableSkillDto,
  SkillRepoDto,
  UnmanagedSkillEntryDto,
} from './api/skill'
import type {
  UsageSyncSummaryResponse,
  UsageSummaryResponse,
  UsageTrendPointResponse,
  PlatformUsageBreakdownResponse,
  UsageSyncStatusResponse,
  ActivitySyncSummaryResponse,
  ActivityTrendPointResponse,
  BackupEntryDto,
  LocalBackupConfigDto,
} from './api/usage'
import type {
  McpServerDto,
  McpServerSpec,
  UnmanagedMcpEntryDto,
  UpsertMcpServerRequest,
  ToggleMcpAppRequest,
  ImportSelectedMcpRequest,
  WebdavConfig,
  TestConnectionArgs,
  SaveConfigArgs,
  DownloadResult,
  RemoteInfo,
  ToolProbeDto,
  SessionToolDto,
  SessionPageDto,
  SessionMessageDto,
  SessionDeleteRequestDto,
  SessionDeleteOutcomeDto,
  CodexRepairPreviewDto,
  CodexRepairRequestDto,
  CodexRepairResultDto,
  CodexRepairProgressDto,
} from './api/integrations'
import type {
  ProxyDto,
  CreateProxyRequest,
  UpdateProxyRequest,
  ProxyImportSummary,
  ProxyTestResultDto,
  AccountBindingDto,
  ApiProxyStatus,
  ApiProxyKeyMeta,
  ApiProxySelectionConfigDto,
  AccountPoolHealthRow,
  ProxyRequestRecord,
  RouteComboDto,
  RouteComboInputDto,
  RoutingWindowDto,
  RoutingGranularityDto,
  RoutingBreakdownDimDto,
  RoutingSummaryDto,
  RoutingTrendPointDto,
  RoutingBreakdownRowDto,
  RoutingErrorRowDto,
  RoutingRecentFilterDto,
  RoutingRecentRowDto,
  AccountGroupDto,
  CreateAccountGroupRequest,
  UpdateAccountGroupRequest,
  AccountGroupMembershipDto,
  AccountGroupBindingDto,
  UpdateStatus,
  ClientConfigClientInfo,
  ClientConfigVersionInfo,
  ClientConfigUpgradeResult,
  ClientConfigUpgradePlan,
  ClientConfigClientId,
  ClientConfigInstallReport,
  ClientConfigProfileDto,
  CreateClientConfigProfileDto,
  UpdateClientConfigProfileDto,
  ClientConfigDiffFile,
  ClientConfigDraftInput,
  ClientConfigFetchModelsInput,
  ClientConfigSnapshotDto,
  ClientConfigConnTest,
} from './api/routing'
// 值导出（非类型）：反代池平台判定，供渲染层判断账号是否可入池。
export { PROXY_POOL_PLATFORMS, isProxyPoolPlatform } from './api/routing'
export type { ProxyPoolPlatform } from './api/routing'

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
    importTokenJson(
      provider: string,
      payload: string,
      proxyId?: string,
    ): Promise<ImportedCredentialMaterial>
    scanLocalCredentials(provider: string, proxyId?: string): Promise<ImportedCredentialMaterial[]>
    importDeeplink(
      provider: string,
      url: string,
      proxyId?: string,
    ): Promise<ImportedCredentialMaterial>
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
    searchSkillsSh(req: {
      query: string
      limit?: number
      offset?: number
    }): Promise<DiscoverableSkillDto[]>
    getSkillRepos(): Promise<SkillRepoDto[]>
    addSkillRepo(req: { owner: string; name: string; branch: string }): Promise<void>
    removeSkillRepo(req: { owner: string; name: string }): Promise<void>
    scanUnmanagedSkills(agentId: string): Promise<UnmanagedSkillEntryDto[]>
    importSkillsFromApps(req: {
      agent_id: string
      dir_names: string[]
    }): Promise<InstalledSkillDto[]>
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
    getUsageSummary(window: TimeWindowDto): Promise<UsageSummaryResponse>
    getUsageTrend(
      window: TimeWindowDto,
      granularity: TrendGranularityDto,
      metric: string,
    ): Promise<UsageTrendPointResponse[]>
    getUsagePlatformBreakdown(window: TimeWindowDto): Promise<PlatformUsageBreakdownResponse[]>
    getUsageSyncStatus(): Promise<UsageSyncStatusResponse>
  }
  activity: {
    syncActivity(): Promise<ActivitySyncSummaryResponse>
    getActivityTrend(
      window: TimeWindowDto,
      granularity: TrendGranularityDto,
      metric: string,
    ): Promise<ActivityTrendPointResponse[]>
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
    /** 查询账号池运行态健康（合并持久化 meta + 内存运行态 + 入池标识 + 窗口内请求统计）。 */
    getAccountPoolHealth(window?: RoutingWindowDto): Promise<AccountPoolHealthRow[]>
    /** 设置账号是否在反代池内（加入/移出池标识）。 */
    setAccountPooled(accountId: string, pooled: boolean): Promise<void>
    /** 设置账号选号权重优先级（仅对在池账号生效）。 */
    setAccountPriority(accountId: string, priority: number): Promise<void>
    /** 设置账号并发上限（仅对在池账号生效）。 */
    setAccountConcurrency(accountId: string, concurrency: number): Promise<void>
    /** 批量设置账号 429 限流冷却覆盖（ms：0=用全局/-1=不冷却/>0=自定义；仅对在池账号生效）。返回生效 id。 */
    setAccountRateLimitCooldown(accountIds: string[], rateLimitCooldownMs: number): Promise<string[]>
    /** 列出已入池的账号 id（供账号管理页显示入池开关状态）。 */
    getPooledAccountIds(): Promise<string[]>
    /** 读取反代池全局选号配置（轮询策略 / 亲密度 / 每账号并发）。 */
    getSelectionConfig(): Promise<ApiProxySelectionConfigDto>
    /** 保存反代池全局选号配置（持久化 + 运行时热更选号器）。 */
    setSelectionConfig(config: ApiProxySelectionConfigDto): Promise<void>
    /** 拉取最近 N 条请求日志（G3）；省略 limit 返回环形缓冲全部。 */
    getRequestLog(limit?: number): Promise<ProxyRequestRecord[]>
    /** 清空请求日志环形缓冲（计数器保持单调，不影响 /metrics）。 */
    clearRequestLog(): Promise<void>
    /** 订阅请求日志推送（G3）。返回取消订阅函数。 */
    onRequestLog(cb: (record: ProxyRequestRecord) => void): () => void
    /** 列出所有路由组合。 */
    listCombos(): Promise<RouteComboDto[]>
    /** 新建路由组合（名字非法/撞模型或组合/空步骤会 reject）。 */
    createCombo(input: RouteComboInputDto): Promise<RouteComboDto>
    /** 更新路由组合。 */
    updateCombo(id: string, patch: Partial<RouteComboInputDto>): Promise<RouteComboDto>
    /** 删除路由组合。 */
    deleteCombo(id: string): Promise<void>
    /** 可路由模型 id 清单（别名前缀形式，如 kr/claude-sonnet-4.5）；组合步骤选择器用。 */
    listRoutableModels(): Promise<string[]>
    /** 手动刷新 kiro 模型快照（按「会员最高」可用账号重拉 ListAvailableModels 重建）。 */
    refreshModels(): Promise<void>
  }
  /** 路由日志分析（持久化反代请求日志的多维聚合查询）。 */
  routingLog: {
    /** 窗口内汇总（请求/成功率/延迟 P95/Token/降级与组合占比）。 */
    summary(window: RoutingWindowDto): Promise<RoutingSummaryDto>
    /** 趋势序列：hour 走明细秒桶，day 走日桶 rollup。 */
    trend(
      window: RoutingWindowDto,
      granularity: RoutingGranularityDto,
    ): Promise<RoutingTrendPointDto[]>
    /** 维度下钻（平台/组合/模型/状态/账号）。 */
    breakdown(
      window: RoutingWindowDto,
      dimension: RoutingBreakdownDimDto,
    ): Promise<RoutingBreakdownRowDto[]>
    /** Top 错误（按脱敏消息归并）。 */
    topErrors(window: RoutingWindowDto, limit?: number): Promise<RoutingErrorRowDto[]>
    /** 最近请求明细（可按成功/失败/平台/组合过滤）。 */
    recent(limit?: number, filter?: RoutingRecentFilterDto): Promise<RoutingRecentRowDto[]>
    /** 清空持久化日志（明细 + 日桶）。 */
    clear(): Promise<void>
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
    /** 启用/停用 codex 接入档 + 会话迁移合并为单次 Codex 重启。返回迁移结果或 null（无库/无可迁移）。 */
    codexSwitchRepair(args: {
      id: string
      action: 'enable' | 'disable'
    }): Promise<CodexRepairResultDto | null>
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
    /** 各客户端 CLI 已装版本 + 最新版 + 可升级（慢，主进程 TTL 缓存）。 */
    versions(): Promise<ClientConfigVersionInfo[]>
    /** 升级前规划：将执行的锚定命令 + 是否需确认（≥2 处安装）+ 全部安装（供确认弹窗）。 */
    planUpgrade(clientId: ClientConfigClientId): Promise<ClientConfigUpgradePlan>
    /** 一键升级某客户端 CLI（后台静默跑），返回结果 + 升级后重探的版本信息。 */
    upgrade(clientId: ClientConfigClientId): Promise<ClientConfigUpgradeResult>
    /** 一键安装某客户端 CLI（未安装时，后台静默跑），返回结果 + 安装后重探的版本信息。 */
    install(clientId: ClientConfigClientId): Promise<ClientConfigUpgradeResult>
    /** 多处安装冲突诊断（省略 clientIds 诊断全部）。 */
    diagnose(clientIds?: ClientConfigClientId[]): Promise<ClientConfigInstallReport[]>
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
    /** 「路由」开关（按客户端）：开/关后按新路由形态重注入该客户端当前生效的供应商。idempotent。
     *  Codex：重选当前供应商(注入单反代 provider+catalog 或直连)；switch 客户端：重 apply 当前档。 */
    setRouting(clientId: ClientConfigClientId, enabled: boolean): Promise<void>
    /** Codex L2 下切换第三方供应商启用态：标记 enabled + 重聚合(供/撤 relay、刷新 catalog)，不做 L1 注入。 */
    setCodexProviderEnabled(id: string, enabled: boolean): Promise<void>
  }
  shellOpen(target: string): Promise<void>
  getVersion(): Promise<string>
  /** 窗口控制：Linux 由 header 自绘 min/max/close 调用；Windows 用系统原生覆盖按钮。 */
  windowControls: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    /** 订阅最大化态变化（切 max/restore 图标）。返回取消订阅。 */
    onMaximizeChanged(cb: (maximized: boolean) => void): () => void
    /** 仅 Windows：随应用主题更新原生标题栏覆盖按钮(min/max/close)的图标颜色。 */
    setOverlayTheme(isDark: boolean): Promise<void>
  }
}

declare global {
  interface Window {
    api: HxgApi
  }
}
