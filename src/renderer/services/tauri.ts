/**
 * IPC service layer - wraps the Electron preload bridge for type safety and
 * error handling. (Migrated from Tauri `invoke` to `window.api.*`.)
 */
import { bridge } from './bridge';

/**
 * Generic invoke wrapper. Migration shim: the implemented contexts (account,
 * agent, settings, system, skill, usage, localBackup, health) now call the
 * Electron `window.api.*` bridge directly. The services whose main-process
 * context is NOT yet implemented (quota, ws, credential OAuth/import, mcp, sync)
 * still call tauriInvoke and throw "not yet migrated" until those contexts land.
 */
export const tauriInvoke = async <T>(_cmd: string, _args?: Record<string, unknown>): Promise<T> => {
  throw new Error(`IPC command "${_cmd}" not yet migrated to the Electron bridge`);
};

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
};

// ============================================================================
// Quota Commands
// ============================================================================

export const quotaService = {
  refreshQuota: (accountId: string) =>
    tauriInvoke<QuotaInfo>('refresh_quota', { accountId }),

  refreshAll: () =>
    tauriInvoke<QuotaRefreshResult[]>('refresh_all_quotas'),

  getQuota: (accountId: string) =>
    tauriInvoke<QuotaInfo>('get_quota', { accountId }),

  getQuotaState: (accountId: string) =>
    tauriInvoke<AccountQuotaState>('get_quota_state', { accountId }),

  refreshQuotaState: (accountId: string) =>
    tauriInvoke<AccountQuotaState>('refresh_quota_state', { accountId }),
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
    tauriInvoke<WsStatus>('get_ws_status'),

  toggleWs: (enabled: boolean) =>
    tauriInvoke<void>('toggle_ws', { enabled }),
};

// ============================================================================
// System / App Info Commands
// ============================================================================

export const systemService = {
  getAppDirs: () => bridge().system.getAppDirs() as Promise<AppDirs>,
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
    tauriInvoke<OAuthPending>("start_oauth", { provider, mode }),

  completeOAuth: (pendingId: string, code: string) =>
    tauriInvoke<ImportedCredentialMaterial>("complete_oauth", {
      pendingId,
      code,
    }),

  importTokenJson: (provider: string, payload: string) =>
    tauriInvoke<ImportedCredentialMaterial>("import_token_json", {
      provider,
      payload,
    }),

  scanLocalCredentials: (provider: string) =>
    tauriInvoke<ImportedCredentialMaterial[]>("scan_local_credentials", {
      provider,
    }),

  importDeeplink: (provider: string, url: string) =>
    tauriInvoke<ImportedCredentialMaterial>("import_deeplink", {
      provider,
      url,
    }),
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
    bridge().account.validateCredential(accountId) as Promise<CredentialValidationResult>,

  getAccountHealth: (accountId: string) =>
    bridge().account.getAccountHealth(accountId) as Promise<HealthSnapshot>,

  validateBatch: (accountIds: string[], concurrency = 4) =>
    bridge().account.validateBatch(accountIds, concurrency) as Promise<
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
    tauriInvoke<McpServer[]>('get_mcp_servers'),

  upsertMcpServer: (request: UpsertMcpServerRequest) =>
    tauriInvoke<McpServer>('upsert_mcp_server', { request }),

  deleteMcpServer: (serverId: string) =>
    tauriInvoke<boolean>('delete_mcp_server', { serverId }),

  toggleMcpApp: (request: { server_id: string; agent_id: string; enabled: boolean }) =>
    tauriInvoke<void>('toggle_mcp_app', { request }),

  importMcpFromApps: () =>
    tauriInvoke<ImportMcpResult>('import_mcp_from_apps'),

  validateMcpCommand: (command: string) =>
    tauriInvoke<ValidateCommandResult>('validate_mcp_command', { command }),

  getClaudeMcpStatus: () =>
    tauriInvoke<Record<string, unknown>>('get_claude_mcp_status'),

  readAgentMcpConfig: (agentId: string) =>
    tauriInvoke<Record<string, McpServerSpec>>('read_agent_mcp_config', { agentId }),

  scanUnmanagedMcp: () =>
    tauriInvoke<UnmanagedMcpEntry[]>('scan_unmanaged_mcp'),

  importSelectedMcp: (selections: Array<{ server_id: string; agent_ids: string[] }>) =>
    tauriInvoke<ImportMcpResult>('import_selected_mcp', { request: { selections } }),
};

// ============================================================================
// WebDAV Sync Commands (2c 后端：modules/sync/api.rs)
// ============================================================================

import type { WebdavConfig, RemoteInfo, DownloadResult } from '../types';

export const syncService = {
  getConfig: () =>
    tauriInvoke<WebdavConfig>('webdav_get_config'),

  testConnection: (config: WebdavConfig, password: string | undefined, passwordTouched: boolean) =>
    tauriInvoke<{ success: boolean }>('webdav_test_connection', {
      config,
      password,
      passwordTouched,
    }),

  saveConfig: (args: {
    config: WebdavConfig;
    password?: string;
    passwordTouched: boolean;
    syncPassword?: string;
    syncPasswordTouched: boolean;
  }) => tauriInvoke<void>('webdav_save_config', args),

  syncUpload: () =>
    tauriInvoke<{ status: string }>('webdav_sync_upload'),

  syncDownload: () =>
    tauriInvoke<DownloadResult>('webdav_sync_download'),

  fetchRemoteInfo: () =>
    tauriInvoke<RemoteInfo>('webdav_fetch_remote_info'),
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
