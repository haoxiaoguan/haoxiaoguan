/**
 * IPC service layer - wraps the Electron preload bridge for type safety and
 * error handling. (Migrated from Tauri `invoke` to `window.api.*`.) All service
 * groups now call the Electron `window.api.*` bridge directly.
 */
import { bridge } from './bridge';

// ============================================================================
// Account Commands
// ============================================================================

import type {
  Account,
  AgentInfo,
  ImportAccountRequest,
  FilterAccountsRequest,
  BatchDeleteResponse,
  AccountQuotaState,
  QuotaInfo,
  QuotaRefreshResult,
  Settings,
  UpdateSettingsRequest,
  WsStatus,
  AppDirs,
  AppPathInfo,
  ActiveDetectionResult,
  ExportAccountsRequest,
  ImportAccountsRequest,
  ImportResultResponse,
  PlatformUsageBreakdownResponse,
  UsageSummaryResponse,
  UsageSyncStatusResponse,
  UsageSyncSummaryResponse,
  UsageTrendPointResponse,
} from '../types';

export const accountService = {
  importAccount: (request: ImportAccountRequest) =>
    bridge().account.importAccount(request) as Promise<Account>,

  switchAccount: (accountId: string) =>
    bridge().account.switchAccount(accountId),

  detectActiveAccounts: () =>
    bridge().account.detectActiveAccounts() as Promise<ActiveDetectionResult[]>,

  deleteAccount: (accountId: string) =>
    bridge().account.deleteAccount(accountId),

  batchDelete: (accountIds: string[]) =>
    bridge().account.batchDelete(accountIds) as Promise<BatchDeleteResponse>,

  filterAccounts: (filter: FilterAccountsRequest) =>
    bridge().account.filterAccounts(filter) as Promise<Account[]>,

  getAccountsByAgent: (agentId: string) =>
    bridge().account.getAccountsByPlatform(agentId) as Promise<Account[]>,

  exportAccounts: (request: ExportAccountsRequest) =>
    bridge().account.exportAccounts(request),

  importAccounts: (request: ImportAccountsRequest) =>
    bridge().account.importAccounts(request) as Promise<ImportResultResponse>,

  updateAccount: (
    accountId: string,
    patch: { name?: string | null; tags?: string[]; notes?: string | null },
  ) => bridge().account.updateAccount(accountId, patch) as Promise<Account>,

  reauthenticate: (
    accountId: string,
    input: {
      identifier: string;
      token: string;
      refreshToken?: string;
      expiresAt?: string;
      rawMetadata?: unknown;
    },
  ) => bridge().account.reauthenticate(accountId, input) as Promise<Account>,
};

// ============================================================================
// Quota Commands
// ============================================================================

export const quotaService = {
  refreshQuota: (accountId: string) =>
    bridge().quota.refreshQuota({ accountId }) as Promise<QuotaInfo>,

  refreshAll: () =>
    bridge().quota.refreshAllQuotas() as Promise<QuotaRefreshResult[]>,

  getQuota: (accountId: string) =>
    bridge().quota.getQuota({ accountId }) as Promise<QuotaInfo>,

  getQuotaState: (accountId: string) =>
    bridge().quota.getQuotaState({ accountId }) as Promise<AccountQuotaState>,

  refreshQuotaState: (accountId: string) =>
    bridge().quota.refreshQuotaState({ accountId }) as Promise<AccountQuotaState>,
};

// ============================================================================
// Settings Commands
// ============================================================================

export const settingsService = {
  getSettings: () => bridge().settings.getSettings() as Promise<Settings>,

  updateSettings: (request: UpdateSettingsRequest) =>
    bridge().settings.updateSettings(request as unknown as { settings: Record<string, string> }),

  setAutostart: (enabled: boolean) => bridge().settings.setAutostart(enabled),
};

// ============================================================================
// WebSocket Commands
// ============================================================================

export const wsService = {
  getWsStatus: () =>
    bridge().ws.getWsStatus() as Promise<WsStatus>,

  toggleWs: (enabled: boolean) =>
    bridge().ws.toggleWs(enabled),
};

// ============================================================================
// System / App Info Commands
// ============================================================================

export const systemService = {
  getAppDirs: () => bridge().system.getAppDirs() as Promise<AppDirs>,
  pickPath: () => bridge().system.pickPath() as Promise<string | null>,
  detectAppPath: (platform: string) => bridge().system.detectAppPath(platform) as Promise<AppPathInfo>,
  onQuotaUpdated: (cb: (accountIds: string[]) => void) => bridge().system.onQuotaUpdated(cb),
  onUsageSynced: (cb: () => void) => bridge().system.onUsageSynced(cb),
};

// ============================================================================
// Agent Commands
// ============================================================================

export const agentService = {
  listAgents: () =>
    bridge().agent.listAgents() as Promise<AgentInfo[]>,

  getAgentInfo: (agentId: string) =>
    bridge().agent.getAgentInfo({ agentId }) as Promise<AgentInfo>,

  listByCapability: (capability: string) =>
    bridge().agent.listAgentsByCapability({ capability }) as Promise<AgentInfo[]>,

  getCapabilities: (agentId: string) =>
    bridge().agent.getAgentCapabilities({ agentId }),
};

// ============================================================================
// Usage Commands
// ============================================================================

export const usageService = {
  syncUsageSources: () =>
    bridge().usage.syncUsageSources() as Promise<UsageSyncSummaryResponse>,

  getUsageSummary: (range: string) =>
    bridge().usage.getUsageSummary(range) as Promise<UsageSummaryResponse>,

  getUsageTrend: (range: string, metric: string) =>
    bridge().usage.getUsageTrend(range, metric) as Promise<UsageTrendPointResponse[]>,

  getUsagePlatformBreakdown: (range: string) =>
    bridge().usage.getUsagePlatformBreakdown(range) as Promise<PlatformUsageBreakdownResponse[]>,

  getUsageSyncStatus: () =>
    bridge().usage.getUsageSyncStatus() as Promise<UsageSyncStatusResponse>,
};

// ============================================================================
// Phase 3: OAuth + Import Commands
// ============================================================================

export type OAuthMode = "loopback_pkce" | "deep_link";

export interface OAuthPending {
  pending_id: string;
  authorize_url: string;
  redirect_path: string;
  bound_port?: number;
}

export interface ImportedCredentialMaterial {
  provider: string;
  email: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  source: "oauth" | "local_scan" | "token_json_file" | "deep_link";
  raw_metadata?: unknown;
}

export const credentialService = {
  startOAuth: (provider: string, mode: OAuthMode) =>
    bridge().credential.startOauth(provider, mode) as Promise<OAuthPending>,

  completeOAuth: (pendingId: string, code: string, proxyId?: string, accountId?: string) =>
    bridge().credential.completeOauth(pendingId, code, proxyId, accountId) as Promise<ImportedCredentialMaterial>,

  importTokenJson: (provider: string, payload: string, proxyId?: string) =>
    bridge().credential.importTokenJson(provider, payload, proxyId) as Promise<ImportedCredentialMaterial>,

  scanLocalCredentials: (provider: string, proxyId?: string) =>
    bridge().credential.scanLocalCredentials(provider, proxyId) as Promise<ImportedCredentialMaterial[]>,

  importDeeplink: (provider: string, url: string, proxyId?: string) =>
    bridge().credential.importDeeplink(provider, url, proxyId) as Promise<ImportedCredentialMaterial>,
};

// ============================================================================
// Phase 4: Validation + Health Commands
// ============================================================================

export type ValidationState =
  | "valid"
  | "expired"
  | "revoked"
  | "rate_limited"
  | "network_error"
  | "unknown_error"
  | "unsupported"
  | "pending";

export interface CredentialValidationResult {
  state: ValidationState;
  checked_at: string;
  details?: string;
  expires_at?: string;
}

export type QuotaOutcome = "success" | "unsupported" | "stale" | "failed";
export type QuotaSource = "live" | "cache" | "none";
export type QuotaFreshness = "fresh" | "stale" | "unknown";

export interface QuotaFetchResult {
  outcome: QuotaOutcome;
  source: QuotaSource;
  freshness: QuotaFreshness;
  fetched_at: string;
  models: Array<{ model_name: string; used: number; total: number; reset_at?: string }>;
  error?: string;
}

export interface HealthSnapshot {
  account_id: string;
  validation: CredentialValidationResult;
  quota?: QuotaFetchResult;
  checked_at: string;
}

export const healthService = {
  validateCredential: (accountId: string) =>
    bridge().credential.validateCredential(accountId) as Promise<CredentialValidationResult>,

  getAccountHealth: (accountId: string) =>
    bridge().account.getAccountHealth(accountId) as Promise<HealthSnapshot>,

  validateBatch: (accountIds: string[], concurrency = 4) =>
    bridge().credential.validateBatch(accountIds, concurrency) as Promise<
      Array<
        | { account_id: string; result: CredentialValidationResult }
        | { account_id: string; error: string }
      >
    >,
};

// ============================================================================
// Skill Commands
// ============================================================================

import type {
  InstalledSkill,
  DiscoverableSkill,
  SkillRepo,
  SkillBackupEntry,
  UnmanagedSkillEntry,
  SkillUpdateCheckResult,
} from '../types';

export const skillsService = {
  getInstalledSkills: () =>
    bridge().skill.getInstalledSkills() as Promise<InstalledSkill[]>,

  installSkillUnified: (request: {
    name: string;
    description?: string;
    directory: string;
    repo_owner: string;
    repo_name: string;
    repo_branch: string;
    readme_url?: string;
    agent_id: string;
  }) => bridge().skill.installSkillUnified(request) as Promise<InstalledSkill>,

  uninstallSkillUnified: (skillId: string) =>
    bridge().skill.uninstallSkillUnified(skillId) as Promise<unknown>,

  toggleSkillApp: (request: { skill_id: string; agent_id: string; enabled: boolean }) =>
    bridge().skill.toggleSkillApp(request),

  updateSkill: (skillId: string) =>
    bridge().skill.updateSkill(skillId) as Promise<InstalledSkill>,

  checkSkillUpdates: (skillId: string) =>
    bridge().skill.checkSkillUpdates(skillId) as Promise<SkillUpdateCheckResult>,

  getSkillBackups: () =>
    bridge().skill.getSkillBackups() as Promise<SkillBackupEntry[]>,

  deleteSkillBackup: (backupId: string) =>
    bridge().skill.deleteSkillBackup(backupId),

  restoreSkillBackup: (backupId: string) =>
    bridge().skill.restoreSkillBackup(backupId) as Promise<InstalledSkill>,

  discoverAvailableSkills: () =>
    bridge().skill.discoverAvailableSkills() as Promise<DiscoverableSkill[]>,

  searchSkillsSh: (request: { query: string; limit?: number; offset?: number }) =>
    bridge().skill.searchSkillsSh(request) as Promise<DiscoverableSkill[]>,

  getSkillRepos: () =>
    bridge().skill.getSkillRepos() as Promise<SkillRepo[]>,

  addSkillRepo: (request: { owner: string; name: string; branch: string }) =>
    bridge().skill.addSkillRepo(request),

  removeSkillRepo: (request: { owner: string; name: string }) =>
    bridge().skill.removeSkillRepo(request),

  scanUnmanagedSkills: (agentId: string) =>
    bridge().skill.scanUnmanagedSkills(agentId) as Promise<UnmanagedSkillEntry[]>,

  importSkillsFromApps: (request: { agent_id: string; dir_names: string[] }) =>
    bridge().skill.importSkillsFromApps(request) as Promise<InstalledSkill[]>,

  openZipFileDialog: () =>
    bridge().skill.openZipFileDialog(),

  installSkillsFromZip: (zipPath: string) =>
    bridge().skill.installSkillsFromZip(zipPath) as Promise<InstalledSkill[]>,

  migrateSkillStorage: (skillId: string, target: string) =>
    bridge().skill.migrateSkillStorage(skillId, target),

  getSkillStorageLocation: () =>
    bridge().skill.getSkillStorageLocation(),

  setSkillStorageLocation: (location: string) =>
    bridge().skill.setSkillStorageLocation(location),

  getSkillSyncMethod: () =>
    bridge().skill.getSkillSyncMethod(),

  setSkillSyncMethod: (method: string) =>
    bridge().skill.setSkillSyncMethod(method),
};

// ============================================================================
// MCP Commands
// ============================================================================

import type {
  McpServer,
  McpServerSpec,
  UpsertMcpServerRequest,
  ImportMcpResult,
  ValidateCommandResult,
  UnmanagedMcpEntry,
} from '../types';

export const mcpService = {
  getMcpServers: () =>
    bridge().mcp.getMcpServers() as Promise<McpServer[]>,

  upsertMcpServer: (request: UpsertMcpServerRequest) =>
    bridge().mcp.upsertMcpServer(
      request as unknown as Parameters<typeof window.api.mcp.upsertMcpServer>[0],
    ) as Promise<McpServer>,

  deleteMcpServer: (serverId: string) =>
    bridge().mcp.deleteMcpServer(serverId),

  toggleMcpApp: (request: { server_id: string; agent_id: string; enabled: boolean }) =>
    bridge().mcp.toggleMcpApp(request),

  importMcpFromApps: () =>
    bridge().mcp.importMcpFromApps() as Promise<ImportMcpResult>,

  validateMcpCommand: (command: string) =>
    bridge().mcp.validateMcpCommand(command) as Promise<ValidateCommandResult>,

  getClaudeMcpStatus: () =>
    bridge().mcp.getClaudeMcpStatus() as Promise<Record<string, unknown>>,

  readAgentMcpConfig: (agentId: string) =>
    bridge().mcp.readAgentMcpConfig(agentId) as Promise<Record<string, McpServerSpec>>,

  scanUnmanagedMcp: () =>
    bridge().mcp.scanUnmanagedMcp() as Promise<UnmanagedMcpEntry[]>,

  importSelectedMcp: (selections: Array<{ server_id: string; agent_ids: string[] }>) =>
    bridge().mcp.importSelectedMcp({ selections }) as Promise<ImportMcpResult>,
};

// ============================================================================
// WebDAV Sync Commands (2c 后端：modules/sync/api.rs)
// ============================================================================

import type { WebdavConfig, RemoteInfo, DownloadResult } from '../types';

export const syncService = {
  getConfig: () =>
    bridge().sync.getConfig() as Promise<WebdavConfig>,

  testConnection: (config: WebdavConfig, password: string | undefined, passwordTouched: boolean) =>
    bridge().sync.testConnection({ config, password, passwordTouched }),

  saveConfig: (args: {
    config: WebdavConfig;
    password?: string;
    passwordTouched: boolean;
    syncPassword?: string;
    syncPasswordTouched: boolean;
  }) => bridge().sync.saveConfig(args),

  syncUpload: () =>
    bridge().sync.syncUpload() as Promise<{ status: string }>,

  syncDownload: () =>
    bridge().sync.syncDownload() as Promise<DownloadResult>,

  fetchRemoteInfo: () =>
    bridge().sync.fetchRemoteInfo() as Promise<RemoteInfo>,
};

// ============================================================================
// Local Backup Commands (modules/local_backup/api.rs)
// ============================================================================

import type { LocalBackupEntry, LocalBackupConfig } from '../types';

export const localBackupService = {
  list: () =>
    bridge().localBackup.list() as Promise<LocalBackupEntry[]>,

  create: () =>
    bridge().localBackup.create() as Promise<LocalBackupEntry>,

  restore: (filename: string) =>
    bridge().localBackup.restore(filename),

  remove: (filename: string) =>
    bridge().localBackup.delete(filename),

  rename: (oldFilename: string, newName: string) =>
    bridge().localBackup.rename({ old_filename: oldFilename, new_name: newName }) as Promise<LocalBackupEntry>,

  getConfig: () =>
    bridge().localBackup.getConfig() as Promise<LocalBackupConfig>,

  saveConfig: (config: LocalBackupConfig) =>
    bridge().localBackup.saveConfig(config),
};

// ============================================================================
// Proxy Commands (proxy 上下文：出站代理 IP 管理)
// ============================================================================

import type {
  ProxyDto,
  AccountBindingDto,
  ProxyImportSummary,
  ProxyTestResultDto,
  CreateProxyRequest,
  UpdateProxyRequest,
  AccountGroupDto,
  AccountGroupBindingDto,
  AccountGroupMembershipDto,
  CreateAccountGroupRequest,
  UpdateAccountGroupRequest,
} from '@shared/api-types';

export const proxyService = {
  listProxies: () => bridge().proxy.listProxies() as Promise<ProxyDto[]>,

  createProxy: (req: CreateProxyRequest) =>
    bridge().proxy.createProxy(req) as Promise<ProxyDto>,

  updateProxy: (id: string, patch: UpdateProxyRequest) =>
    bridge().proxy.updateProxy(id, patch) as Promise<ProxyDto>,

  deleteProxy: (id: string) => bridge().proxy.deleteProxy(id),

  importProxies: (text: string) =>
    bridge().proxy.importProxies(text) as Promise<ProxyImportSummary>,

  testProxy: (id: string) => bridge().proxy.testProxy(id) as Promise<ProxyTestResultDto>,

  testProxies: (ids: string[], concurrency = 4) =>
    bridge().proxy.testProxies(ids, concurrency) as Promise<ProxyTestResultDto[]>,

  listBindings: () => bridge().proxy.listBindings() as Promise<AccountBindingDto[]>,

  getAccountBinding: (accountId: string) =>
    bridge().proxy.getAccountBinding(accountId) as Promise<AccountBindingDto | null>,

  bindAccountToProxy: (accountId: string, proxyId: string) =>
    bridge().proxy.bindAccountToProxy(accountId, proxyId),

  unbindAccount: (accountId: string) => bridge().proxy.unbindAccount(accountId),
};

// ============================================================================
// AccountGroup Commands — cross-platform account groupings + group→proxy binding
// ============================================================================

export const accountGroupService = {
  listGroups: () =>
    bridge().accountGroup.listGroups() as Promise<AccountGroupDto[]>,

  createGroup: (req: CreateAccountGroupRequest) =>
    bridge().accountGroup.createGroup(req) as Promise<AccountGroupDto>,

  updateGroup: (id: string, patch: UpdateAccountGroupRequest) =>
    bridge().accountGroup.updateGroup(id, patch) as Promise<AccountGroupDto>,

  deleteGroup: (id: string, force = false) =>
    bridge().accountGroup.deleteGroup(id, force),

  listMembers: (groupId: string) =>
    bridge().accountGroup.listMembers(groupId) as Promise<AccountGroupMembershipDto[]>,

  listGroupsForAccount: (accountId: string) =>
    bridge().accountGroup.listGroupsForAccount(accountId) as Promise<AccountGroupDto[]>,

  addMembers: (groupId: string, accountIds: string[]) =>
    bridge().accountGroup.addMembers(groupId, accountIds) as Promise<{ added: number }>,

  removeMembers: (groupId: string, accountIds: string[]) =>
    bridge().accountGroup.removeMembers(groupId, accountIds) as Promise<{ removed: number }>,

  bindGroupToProxy: (groupId: string, proxyId: string) =>
    bridge().accountGroup.bindGroupToProxy(groupId, proxyId) as Promise<AccountGroupBindingDto>,

  unbindGroup: (groupId: string) => bridge().accountGroup.unbindGroup(groupId),

  getGroupBinding: (groupId: string) =>
    bridge().accountGroup.getGroupBinding(groupId) as Promise<AccountGroupBindingDto | null>,
};

// ============================================================================
// Sessions Commands (本机 AI 对话历史浏览器)
// ============================================================================

import type {
  SessionToolDto,
  SessionMessageDto,
  ToolProbeDto,
  SessionPageDto,
  SessionDeleteRequestDto,
  SessionDeleteOutcomeDto,
  CodexRepairPreviewDto,
  CodexRepairRequestDto,
  CodexRepairResultDto,
  ActivityTrendPointResponse,
  ActivitySyncSummaryResponse,
} from '@shared/api-types';

export const sessionsService = {
  probeTools: () => bridge().sessions.probeTools() as Promise<ToolProbeDto[]>,
  listSessions: (tool: SessionToolDto, limit?: number, offset?: number) =>
    bridge().sessions.listSessions(tool, limit, offset) as Promise<SessionPageDto>,
  getMessages: (tool: SessionToolDto, sourcePath: string) =>
    bridge().sessions.getMessages(tool, sourcePath) as Promise<SessionMessageDto[]>,
  deleteSession: (tool: SessionToolDto, sourcePath: string, sessionId: string) =>
    bridge().sessions.deleteSession(tool, sourcePath, sessionId),
  deleteSessions: (items: SessionDeleteRequestDto[]) =>
    bridge().sessions.deleteSessions(items) as Promise<SessionDeleteOutcomeDto[]>,
  resume: (command: string, cwd?: string) =>
    bridge().sessions.resume(command, cwd),
  repairPreview: () => bridge().sessions.repairPreview() as Promise<CodexRepairPreviewDto>,
  repair: (req: CodexRepairRequestDto) => bridge().sessions.repair(req) as Promise<CodexRepairResultDto>,
  repairRollback: (backupId: string) => bridge().sessions.repairRollback(backupId) as Promise<void>,
};

// ============================================================================
// Activity Commands (会话活动统计：增量扫描 + 趋势查询)
// ============================================================================

export const activityService = {
  syncActivity: () =>
    bridge().activity.syncActivity() as Promise<ActivitySyncSummaryResponse>,
  getActivityTrend: (range: string, metric: string) =>
    bridge().activity.getActivityTrend(range, metric) as Promise<ActivityTrendPointResponse[]>,
};
