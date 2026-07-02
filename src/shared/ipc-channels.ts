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

export const USAGE_EVENTS = {
  // Fired by the main-process periodic usage sync (60s) after rebuildRollups,
  // so the dashboard can re-pull summary/trend (updates the "last synced" time
  // + numbers) even when its in-page auto-refresh is off.
  synced: 'usage:synced',
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
  exportAccountsCpa: 'account:exportAccountsCpa',
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
  // Codex 主动重置额度：消耗一次 reset credit 后回传最新 quota_state。
  consumeCodexResetCredit: 'consume_codex_reset_credit',
  // Codex 主动重置券明细：每张券的过期时间（hover 展示用）。
  getCodexResetCredits: 'get_codex_reset_credits',
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
  repairPreview: 'sessions:repairPreview',
  repair: 'sessions:repair',
  repairRollback: 'sessions:repairRollback',
  claudeDesktopRepairPreview: 'sessions:claudeDesktopRepairPreview',
  claudeDesktopRepair: 'sessions:claudeDesktopRepair',
  claudeDesktopRepairRollback: 'sessions:claudeDesktopRepairRollback',
  // 启用/停用 codex 接入档 + 会话迁移合并为单次 Codex 重启（main 编排，进度复用 repairProgress 事件）。
  codexSwitchRepair: 'sessions:codexSwitchRepair',
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
  setAccountPooled: 'apiProxy:setAccountPooled',
  setAccountPriority: 'apiProxy:setAccountPriority',
  setAccountConcurrency: 'apiProxy:setAccountConcurrency',
  setAccountRateLimitCooldown: 'apiProxy:setAccountRateLimitCooldown',
  getPooledAccountIds: 'apiProxy:getPooledAccountIds',
  getSelectionConfig: 'apiProxy:getSelectionConfig',
  setSelectionConfig: 'apiProxy:setSelectionConfig',
  // 路由组合（命名的跨供应商降级链）CRUD + 可路由模型清单（组合步骤选择器用）。
  listCombos: 'apiProxy:listCombos',
  createCombo: 'apiProxy:createCombo',
  updateCombo: 'apiProxy:updateCombo',
  deleteCombo: 'apiProxy:deleteCombo',
  listRoutableModels: 'apiProxy:listRoutableModels',
  // 手动刷新 kiro 模型快照（重新按「会员最高」账号拉 ListAvailableModels 重建）。
  refreshModels: 'apiProxy:refreshModels',
} as const

// 路由日志 observability v2（统一明细 routing_events + 4 日桶）。channel 取 "routingObs:<method>"。
// search（keyset 分页 + 全维度过滤 + 关键字）/ detail（单条）/ accountStats。
export const ROUTING_OBS_CHANNELS = {
  summary: 'routingObs:summary',
  trend: 'routingObs:trend',
  breakdown: 'routingObs:breakdown',
  topErrors: 'routingObs:topErrors',
  accountStats: 'routingObs:accountStats',
  search: 'routingObs:search',
  detail: 'routingObs:detail',
  clear: 'routingObs:clear',
} as const

// 主进程 → 渲染层推送：路由日志 observability v2 实时事件（200ms 合并的一批记录）。
// 统一实时出口；前端订阅做实时 tail。
export const ROUTING_OBS_EVENTS = {
  event: 'routingObs:event',
} as const

// 主进程 → 渲染层推送：修复会话进度（sessions:repairProgress）。
export const SESSIONS_EVENTS = {
  repairProgress: 'sessions:repairProgress',
} as const

// Activity context — 会话活动统计（增量扫描 + 趋势查询）。Channel 值 snake_case
// 与 usage 同口径。
export const ACTIVITY_CHANNELS = {
  syncActivity: 'sync_activity',
  getActivityTrend: 'get_activity_trend',
} as const

// 自动更新上下文（updater，G9）—— electron-updater 封装。新功能，channel 取 "updater:<method>"。
export const UPDATER_CHANNELS = {
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  getStatus: 'updater:getStatus',
} as const

// 主进程 → 渲染层推送：更新状态变化（checking/available/downloading/downloaded/error）。
export const UPDATE_EVENTS = {
  status: 'updater:status',
} as const

// 客户端接入管理上下文（clientConfig）—— 把反代/第三方 provider 写进各 CLI 客户端配置。
export const CLIENT_CONFIG_CHANNELS = {
  clients: 'clientConfig:clients',
  versions: 'clientConfig:versions',
  planUpgrade: 'clientConfig:planUpgrade',
  upgrade: 'clientConfig:upgrade',
  install: 'clientConfig:install',
  diagnose: 'clientConfig:diagnose',
  list: 'clientConfig:list',
  create: 'clientConfig:create',
  update: 'clientConfig:update',
  delete: 'clientConfig:delete',
  preview: 'clientConfig:preview',
  previewDraft: 'clientConfig:previewDraft',
  fetchModels: 'clientConfig:fetchModels',
  apply: 'clientConfig:apply',
  clear: 'clientConfig:clear',
  enable: 'clientConfig:enable',
  disable: 'clientConfig:disable',
  setDefault: 'clientConfig:setDefault',
  history: 'clientConfig:history',
  rollback: 'clientConfig:rollback',
  connectLocalProxy: 'clientConfig:connectLocalProxy',
  testConnectivity: 'clientConfig:testConnectivity',
  setRouting: 'clientConfig:setRouting',
  setCodexProviderEnabled: 'clientConfig:setCodexProviderEnabled',
} as const

// analytics 上下文：统一用量统计（usage_events 单表查询）。
export const ANALYTICS_CHANNELS = {
  summary: 'analytics:summary',
  trend: 'analytics:trend',
  agentBreakdown: 'analytics:agentBreakdown',
  modelBreakdown: 'analytics:modelBreakdown',
  search: 'analytics:search',
  listPricing: 'analytics:listPricing',
  upsertPricing: 'analytics:upsertPricing',
  deletePricing: 'analytics:deletePricing',
  getPricingConfig: 'analytics:getPricingConfig',
  setPricingConfig: 'analytics:setPricingConfig',
} as const

// 自绘窗口控制（Linux 无原生标题栏时，渲染层画 min/max/close 调这些）。
// Windows 改用系统原生覆盖按钮（titleBarOverlay），仅需 setOverlayTheme 同步图标颜色。
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  maximizeToggle: 'window:maximizeToggle',
  close: 'window:close',
  isMaximized: 'window:isMaximized',
  setOverlayTheme: 'window:setOverlayTheme',
} as const

// 主进程 → 渲染层：窗口最大化态变化（切换 max/restore 图标）。
export const WINDOW_EVENTS = {
  maximizeChanged: 'window:maximizeChanged',
} as const
