import { contextBridge, ipcRenderer } from 'electron'
import {
  SETTINGS_CHANNELS,
  SYSTEM_CHANNELS,
  AGENT_CHANNELS,
  ACCOUNT_CHANNELS,
  SKILL_CHANNELS,
  USAGE_CHANNELS,
  LOCAL_BACKUP_CHANNELS,
} from '../shared/ipc-channels'
import type { HxgApi } from '../shared/api-types'

const api: HxgApi = {
  settings: {
    getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNELS.getSettings),
    updateSettings: (req) => ipcRenderer.invoke(SETTINGS_CHANNELS.updateSettings, req),
    setAutostart: (enabled) => ipcRenderer.invoke(SETTINGS_CHANNELS.setAutostart, enabled),
  },
  system: {
    getAppDirs: () => ipcRenderer.invoke(SYSTEM_CHANNELS.getAppDirs),
  },
  agent: {
    listAgents: () => ipcRenderer.invoke(AGENT_CHANNELS.listAgents),
    getAgentInfo: (args) => ipcRenderer.invoke(AGENT_CHANNELS.getAgentInfo, args),
    listAgentsByCapability: (args) =>
      ipcRenderer.invoke(AGENT_CHANNELS.listAgentsByCapability, args),
    getAgentCapabilities: (args) => ipcRenderer.invoke(AGENT_CHANNELS.getAgentCapabilities, args),
  },
  account: {
    importAccount: (req) => ipcRenderer.invoke(ACCOUNT_CHANNELS.importAccount, { request: req }),
    switchAccount: (accountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.switchAccount, { accountId }),
    deleteAccount: (accountId) => ipcRenderer.invoke(ACCOUNT_CHANNELS.deleteAccount, { accountId }),
    batchDelete: (accountIds) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.batchDelete, { request: { accountIds } }),
    filterAccounts: (filter) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.filterAccounts, { request: filter }),
    getAccountsByPlatform: (platform) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.getAccountsByPlatform, { platform }),
    switchAccountV2: (args) => ipcRenderer.invoke(ACCOUNT_CHANNELS.switchAccountV2, args),
    exportAccounts: (req) => ipcRenderer.invoke(ACCOUNT_CHANNELS.exportAccounts, { request: req }),
    importAccounts: (req) => ipcRenderer.invoke(ACCOUNT_CHANNELS.importAccounts, { request: req }),
    validateCredential: (accountId) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.validateCredential, { accountId }),
    getAccountHealth: (accountId) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.getAccountHealth, { accountId }),
    validateBatch: (accountIds, concurrency) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.validateBatch, { accountIds, concurrency }),
  },
  skill: {
    getInstalledSkills: () => ipcRenderer.invoke(SKILL_CHANNELS.getInstalledSkills),
    installSkillUnified: (req) => ipcRenderer.invoke(SKILL_CHANNELS.installSkillUnified, req),
    uninstallSkillUnified: (skillId) =>
      ipcRenderer.invoke(SKILL_CHANNELS.uninstallSkillUnified, skillId),
    toggleSkillApp: (req) => ipcRenderer.invoke(SKILL_CHANNELS.toggleSkillApp, req),
    updateSkill: (skillId) => ipcRenderer.invoke(SKILL_CHANNELS.updateSkill, skillId),
    checkSkillUpdates: (skillId) => ipcRenderer.invoke(SKILL_CHANNELS.checkSkillUpdates, skillId),
    getSkillBackups: () => ipcRenderer.invoke(SKILL_CHANNELS.getSkillBackups),
    deleteSkillBackup: (backupId) => ipcRenderer.invoke(SKILL_CHANNELS.deleteSkillBackup, backupId),
    restoreSkillBackup: (backupId) =>
      ipcRenderer.invoke(SKILL_CHANNELS.restoreSkillBackup, backupId),
    discoverAvailableSkills: () => ipcRenderer.invoke(SKILL_CHANNELS.discoverAvailableSkills),
    searchSkillsSh: (req) => ipcRenderer.invoke(SKILL_CHANNELS.searchSkillsSh, req),
    getSkillRepos: () => ipcRenderer.invoke(SKILL_CHANNELS.getSkillRepos),
    addSkillRepo: (req) => ipcRenderer.invoke(SKILL_CHANNELS.addSkillRepo, req),
    removeSkillRepo: (req) => ipcRenderer.invoke(SKILL_CHANNELS.removeSkillRepo, req),
    scanUnmanagedSkills: (agentId) =>
      ipcRenderer.invoke(SKILL_CHANNELS.scanUnmanagedSkills, agentId),
    importSkillsFromApps: (req) => ipcRenderer.invoke(SKILL_CHANNELS.importSkillsFromApps, req),
    openZipFileDialog: () => ipcRenderer.invoke(SKILL_CHANNELS.openZipFileDialog),
    installSkillsFromZip: (zipPath) =>
      ipcRenderer.invoke(SKILL_CHANNELS.installSkillsFromZip, zipPath),
    migrateSkillStorage: (skillId, target) =>
      ipcRenderer.invoke(SKILL_CHANNELS.migrateSkillStorage, skillId, target),
    getSkillStorageLocation: () => ipcRenderer.invoke(SKILL_CHANNELS.getSkillStorageLocation),
    setSkillStorageLocation: (location) =>
      ipcRenderer.invoke(SKILL_CHANNELS.setSkillStorageLocation, location),
    getSkillSyncMethod: () => ipcRenderer.invoke(SKILL_CHANNELS.getSkillSyncMethod),
    setSkillSyncMethod: (method) => ipcRenderer.invoke(SKILL_CHANNELS.setSkillSyncMethod, method),
  },
  usage: {
    syncUsageSources: () => ipcRenderer.invoke(USAGE_CHANNELS.syncUsageSources),
    getUsageSummary: (range) => ipcRenderer.invoke(USAGE_CHANNELS.getUsageSummary, range),
    getUsageTrend: (range, metric) =>
      ipcRenderer.invoke(USAGE_CHANNELS.getUsageTrend, range, metric),
    getUsagePlatformBreakdown: (range) =>
      ipcRenderer.invoke(USAGE_CHANNELS.getUsagePlatformBreakdown, range),
    getUsageSyncStatus: () => ipcRenderer.invoke(USAGE_CHANNELS.getUsageSyncStatus),
  },
  localBackup: {
    create: () => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.create),
    list: () => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.list),
    restore: (filename) => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.restore, filename),
    delete: (filename) => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.delete, filename),
    rename: (arg) => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.rename, arg),
    getConfig: () => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.getConfig),
    saveConfig: (config) => ipcRenderer.invoke(LOCAL_BACKUP_CHANNELS.saveConfig, config),
  },
  shellOpen: (target) => ipcRenderer.invoke('shell:open', target),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
}

contextBridge.exposeInMainWorld('api', api)
