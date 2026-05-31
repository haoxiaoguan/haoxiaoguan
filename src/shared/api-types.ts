// The typed surface exposed on window.api. Covers every IPC service namespace
// whose backing context is implemented (settings, system, agent, account, skill,
// usage, localBackup) plus the version/shell helpers. The credential, quota,
// mcp, and sync contexts are not yet implemented in the main process, so they
// are intentionally absent — the renderer keeps calling the throwing tauriInvoke
// shim for those until they land.
export interface SettingsResponse {
  theme: string
  language: string
  closeBehavior: string
  wsPort: number
  refreshIntervals: Record<string, number>
  silentStart: boolean
  autostart: boolean
  utilityButtons: string
}
export interface AppDirs {
  dataDir: string
  configDir: string
  logDir: string
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

export interface HxgApi {
  settings: {
    getSettings(): Promise<SettingsResponse>
    updateSettings(req: { settings: Record<string, string> }): Promise<void>
    setAutostart(enabled: boolean): Promise<void>
  }
  system: {
    getAppDirs(): Promise<AppDirs>
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
  shellOpen(target: string): Promise<void>
  getVersion(): Promise<string>
}

declare global {
  interface Window {
    api: HxgApi
  }
}
