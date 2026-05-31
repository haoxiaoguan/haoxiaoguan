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
  getAccountHealth: 'account:getAccountHealth',
  validateCredential: 'account:validateCredential',
  validateBatch: 'account:validateBatch',
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
