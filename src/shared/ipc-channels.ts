// Channel naming: "<service>:<method>". The renderer never sees these strings
// directly — the preload bridge maps typed methods onto them. Args/return
// shapes for each are fixed by the source frontend contract
// (.omc/alignment/map_frontend_ipc.md).
export const SETTINGS_CHANNELS = {
  getSettings: 'settings:getSettings',
  updateSettings: 'settings:updateSettings',
  setAutostart: 'settings:setAutostart',
} as const

export const SYSTEM_CHANNELS = {
  getAppDirs: 'system:getAppDirs',
  pickPath: 'system:pickPath',
  detectAppPath: 'system:detectAppPath',
} as const

// Main → renderer push events (webContents.send). Not request/response.
export const QUOTA_EVENTS = {
  // Fired by PlatformQuotaScheduler after a batch/active sweep refreshes
  // accounts, so the renderer can re-pull the affected quota states.
  updated: 'quota:updated',
} as const

export const SKILL_CHANNELS = {
  getInstalledSkills: 'skill:getInstalledSkills',
  installSkillUnified: 'skill:installSkillUnified',
  uninstallSkillUnified: 'skill:uninstallSkillUnified',
  toggleSkillApp: 'skill:toggleSkillApp',
  updateSkill: 'skill:updateSkill',
  checkSkillUpdates: 'skill:checkSkillUpdates',
  getSkillBackups: 'skill:getSkillBackups',
  deleteSkillBackup: 'skill:deleteSkillBackup',
  restoreSkillBackup: 'skill:restoreSkillBackup',
  discoverAvailableSkills: 'skill:discoverAvailableSkills',
  searchSkillsSh: 'skill:searchSkillsSh',
  getSkillRepos: 'skill:getSkillRepos',
  addSkillRepo: 'skill:addSkillRepo',
  removeSkillRepo: 'skill:removeSkillRepo',
  scanUnmanagedSkills: 'skill:scanUnmanagedSkills',
  importSkillsFromApps: 'skill:importSkillsFromApps',
  openZipFileDialog: 'skill:openZipFileDialog',
  installSkillsFromZip: 'skill:installSkillsFromZip',
  migrateSkillStorage: 'skill:migrateSkillStorage',
  getSkillStorageLocation: 'skill:getSkillStorageLocation',
  setSkillStorageLocation: 'skill:setSkillStorageLocation',
  getSkillSyncMethod: 'skill:getSkillSyncMethod',
  setSkillSyncMethod: 'skill:setSkillSyncMethod',
} as const

// Usage context. Channel string VALUES match the source Rust command names
// (snake_case, no service prefix) per the usage manifest §3.
export const USAGE_CHANNELS = {
  syncUsageSources: 'sync_usage_sources',
  getUsageSummary: 'get_usage_summary',
  getUsageTrend: 'get_usage_trend',
  getUsagePlatformBreakdown: 'get_usage_platform_breakdown',
  getUsageSyncStatus: 'get_usage_sync_status',
} as const

// Agents shared-layer registry (read-only). Values are fixed per the agents
// manifest §3 and must not change.
export const AGENT_CHANNELS = {
  listAgents: 'agent:listAgents',
  getAgentInfo: 'agent:getAgentInfo',
  listAgentsByCapability: 'agent:listAgentsByCapability',
  getAgentCapabilities: 'agent:getAgentCapabilities',
} as const

// Account / health / credential-switch context. Mirrors the local copy in
// contexts/account/ipc/account-channels.ts (account manifest §3).
export const ACCOUNT_CHANNELS = {
  importAccount: 'account:importAccount',
  switchAccount: 'account:switchAccount',
  deleteAccount: 'account:deleteAccount',
  batchDelete: 'account:batchDelete',
  filterAccounts: 'account:filterAccounts',
  getAccountsByPlatform: 'account:getAccountsByPlatform',
  switchAccountV2: 'account:switchAccountV2',
  exportAccounts: 'account:exportAccounts',
  importAccounts: 'account:importAccounts',
  updateAccount: 'account:updateAccount',
  reauthenticate: 'account:reauthenticate',
  getAccountHealth: 'account:getAccountHealth',
  validateCredential: 'account:validateCredential',
  validateBatch: 'account:validateBatch',
  detectActiveAccounts: 'account:detectActiveAccounts',
} as const

// Account-group context — cross-platform account grouping with optional proxy
// binding. Channels are "accountGroup:<method>" since this is a new feature.
export const ACCOUNT_GROUP_CHANNELS = {
  listGroups: 'accountGroup:listGroups',
  createGroup: 'accountGroup:createGroup',
  updateGroup: 'accountGroup:updateGroup',
  deleteGroup: 'accountGroup:deleteGroup',
  listMembers: 'accountGroup:listMembers',
  listGroupsForAccount: 'accountGroup:listGroupsForAccount',
  addMembers: 'accountGroup:addMembers',
  removeMembers: 'accountGroup:removeMembers',
  bindGroupToProxy: 'accountGroup:bindGroupToProxy',
  unbindGroup: 'accountGroup:unbindGroup',
  getGroupBinding: 'accountGroup:getGroupBinding',
} as const

// Credential context. Mirrors the local copy in
// contexts/credential/ipc/credential-channels.ts (credential manifest §3).
// validate_credential / validate_batch are OWNED here (envelope-aware validator)
// — the renderer's healthService points its validation methods at credential:*.
export const CREDENTIAL_CHANNELS = {
  startOauth: 'credential:startOauth',
  completeOauth: 'credential:completeOauth',
  importTokenJson: 'credential:importTokenJson',
  scanLocalCredentials: 'credential:scanLocalCredentials',
  importDeeplink: 'credential:importDeeplink',
  validateCredential: 'credential:validateCredential',
  validateBatch: 'credential:validateBatch',
} as const

// Quota context. Channel string VALUES match the source Rust command names
// (snake_case, no service prefix) per the quota manifest §3.
export const QUOTA_CHANNELS = {
  refreshQuota: 'refresh_quota',
  refreshAllQuotas: 'refresh_all_quotas',
  getQuota: 'get_quota',
  getQuotaState: 'get_quota_state',
  refreshQuotaState: 'refresh_quota_state',
} as const

// MCP context. Channel string VALUES match the Tauri frontend contract
// (map_mcp.md IPC Commands table — exact Rust command names).
export const MCP_CHANNELS = {
  getMcpServers: 'get_mcp_servers',
  upsertMcpServer: 'upsert_mcp_server',
  deleteMcpServer: 'delete_mcp_server',
  toggleMcpApp: 'toggle_mcp_app',
  importMcpFromApps: 'import_mcp_from_apps',
  validateMcpCommand: 'validate_mcp_command',
  getClaudeMcpStatus: 'get_claude_mcp_status',
  readAgentMcpConfig: 'read_agent_mcp_config',
  scanUnmanagedMcp: 'scan_unmanaged_mcp',
  importSelectedMcp: 'import_selected_mcp',
} as const

// Local-backup context. Channel string VALUES match the Tauri frontend contract
// (localBackup manifest §3).
export const LOCAL_BACKUP_CHANNELS = {
  create: 'local_backup_create',
  list: 'local_backup_list',
  restore: 'local_backup_restore',
  delete: 'local_backup_delete',
  rename: 'local_backup_rename',
  getConfig: 'local_backup_get_config',
  saveConfig: 'local_backup_save_config',
} as const

// Sync (WebDAV E2EE) context. Channel string VALUES are the canonical
// command names (snake_case) per the sync manifest §3.
export const SYNC_CHANNELS = {
  getConfig: 'webdav_get_config',
  testConnection: 'webdav_test_connection',
  saveConfig: 'webdav_save_config',
  syncUpload: 'webdav_sync_upload',
  syncDownload: 'webdav_sync_download',
  fetchRemoteInfo: 'webdav_fetch_remote_info',
} as const

// WebSocket push-server context. Command names get_ws_status /
// toggle_ws.
export const WS_CHANNELS = {
  getWsStatus: 'get_ws_status',
  toggleWs: 'toggle_ws',
} as const

// Proxy context — outbound proxy IP management (new feature, no Tauri origin).
// Channels are "proxy:<method>" since there is no source command name to mirror.
export const PROXY_CHANNELS = {
  listProxies: 'proxy:listProxies',
  createProxy: 'proxy:createProxy',
  updateProxy: 'proxy:updateProxy',
  deleteProxy: 'proxy:deleteProxy',
  importProxies: 'proxy:importProxies',
  testProxy: 'proxy:testProxy',
  testProxies: 'proxy:testProxies',
  listBindings: 'proxy:listBindings',
  getAccountBinding: 'proxy:getAccountBinding',
  bindAccountToProxy: 'proxy:bindAccountToProxy',
  unbindAccount: 'proxy:unbindAccount',
} as const

// Sessions context — read-only on-disk AI CLI conversation history browser.
export const SESSIONS_CHANNELS = {
  probeTools: 'sessions:probeTools',
  listSessions: 'sessions:listSessions',
  getMessages: 'sessions:getMessages',
  deleteSession: 'sessions:deleteSession',
  deleteSessions: 'sessions:deleteSessions',
  resume: 'sessions:resume',
} as const

// API 反代服务上下文（apiProxy）—— 本地 HTTP 服务开关 + 状态。新功能，无 Tauri
// 来源命令名，故 channel 取 "apiProxy:<method>"。
export const API_PROXY_CHANNELS = {
  start: 'apiProxy:start',
  stop: 'apiProxy:stop',
  getStatus: 'apiProxy:getStatus',
  clearAccountSuspension: 'apiProxy:clearAccountSuspension',
  createClientKey: 'apiProxy:createClientKey',
  listClientKeys: 'apiProxy:listClientKeys',
  setClientKeyActive: 'apiProxy:setClientKeyActive',
  deleteClientKey: 'apiProxy:deleteClientKey',
  getAccountPoolHealth: 'apiProxy:getAccountPoolHealth',
} as const

// Activity context — 会话活动统计（增量扫描 + 趋势查询）。Channel 值 snake_case
// 与 usage 同口径。
export const ACTIVITY_CHANNELS = {
  syncActivity: 'sync_activity',
  getActivityTrend: 'get_activity_trend',
} as const
