import { contextBridge, ipcRenderer } from 'electron'
import {
  SETTINGS_CHANNELS,
  SYSTEM_CHANNELS,
  QUOTA_EVENTS,
  USAGE_EVENTS,
  AGENT_CHANNELS,
  ACCOUNT_CHANNELS,
  ACCOUNT_GROUP_CHANNELS,
  CREDENTIAL_CHANNELS,
  QUOTA_CHANNELS,
  SKILL_CHANNELS,
  USAGE_CHANNELS,
  LOCAL_BACKUP_CHANNELS,
  MCP_CHANNELS,
  SYNC_CHANNELS,
  WS_CHANNELS,
  PROXY_CHANNELS,
  API_PROXY_CHANNELS,
  API_PROXY_EVENTS,
  SESSIONS_CHANNELS,
  SESSIONS_EVENTS,
  ACTIVITY_CHANNELS,
  UPDATER_CHANNELS,
  UPDATE_EVENTS,
  CLIENT_CONFIG_CHANNELS,
} from '../shared/ipc-channels'
import type { HxgApi, UpdateStatus, ProxyRequestRecord, CodexRepairProgressDto } from '../shared/api-types'

const api: HxgApi = {
  settings: {
    getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNELS.getSettings),
    updateSettings: (req) => ipcRenderer.invoke(SETTINGS_CHANNELS.updateSettings, req),
    setAutostart: (enabled) => ipcRenderer.invoke(SETTINGS_CHANNELS.setAutostart, enabled),
  },
  system: {
    getAppDirs: () => ipcRenderer.invoke(SYSTEM_CHANNELS.getAppDirs),
    pickPath: () => ipcRenderer.invoke(SYSTEM_CHANNELS.pickPath),
    detectAppPath: (platform) => ipcRenderer.invoke(SYSTEM_CHANNELS.detectAppPath, platform),
    onQuotaUpdated: (cb) => {
      const listener = (_e: unknown, accountIds: string[]) => cb(accountIds)
      ipcRenderer.on(QUOTA_EVENTS.updated, listener)
      return () => ipcRenderer.removeListener(QUOTA_EVENTS.updated, listener)
    },
    onUsageSynced: (cb) => {
      const listener = () => cb()
      ipcRenderer.on(USAGE_EVENTS.synced, listener)
      return () => ipcRenderer.removeListener(USAGE_EVENTS.synced, listener)
    },
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
    exportAccountsCpa: (accountIds) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.exportAccountsCpa, { accountIds }),
    importAccounts: (req) => ipcRenderer.invoke(ACCOUNT_CHANNELS.importAccounts, { request: req }),
    updateAccount: (accountId, patch) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.updateAccount, { accountId, patch }),
    reauthenticate: (accountId, input) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.reauthenticate, { accountId, ...input }),
    validateCredential: (accountId) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.validateCredential, { accountId }),
    getAccountHealth: (accountId) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.getAccountHealth, { accountId }),
    validateBatch: (accountIds, concurrency) =>
      ipcRenderer.invoke(ACCOUNT_CHANNELS.validateBatch, { accountIds, concurrency }),
    detectActiveAccounts: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.detectActiveAccounts),
  },
  credential: {
    startOauth: (provider, mode) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.startOauth, { provider, mode }),
    completeOauth: (pendingId, code, proxyId, accountId) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.completeOauth, { pendingId, code, proxyId, accountId }),
    importTokenJson: (provider, payload, proxyId) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.importTokenJson, { provider, payload, proxyId }),
    scanLocalCredentials: (provider, proxyId) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.scanLocalCredentials, { provider, proxyId }),
    importDeeplink: (provider, url, proxyId) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.importDeeplink, { provider, url, proxyId }),
    validateCredential: (accountId) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.validateCredential, { accountId }),
    validateBatch: (accountIds, concurrency) =>
      ipcRenderer.invoke(CREDENTIAL_CHANNELS.validateBatch, { accountIds, concurrency }),
  },
  quota: {
    refreshQuota: (args) => ipcRenderer.invoke(QUOTA_CHANNELS.refreshQuota, args),
    refreshAllQuotas: () => ipcRenderer.invoke(QUOTA_CHANNELS.refreshAllQuotas),
    getQuota: (args) => ipcRenderer.invoke(QUOTA_CHANNELS.getQuota, args),
    getQuotaState: (args) => ipcRenderer.invoke(QUOTA_CHANNELS.getQuotaState, args),
    refreshQuotaState: (args) => ipcRenderer.invoke(QUOTA_CHANNELS.refreshQuotaState, args),
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
  mcp: {
    getMcpServers: () => ipcRenderer.invoke(MCP_CHANNELS.getMcpServers),
    upsertMcpServer: (request) => ipcRenderer.invoke(MCP_CHANNELS.upsertMcpServer, request),
    deleteMcpServer: (server_id) => ipcRenderer.invoke(MCP_CHANNELS.deleteMcpServer, server_id),
    toggleMcpApp: (request) => ipcRenderer.invoke(MCP_CHANNELS.toggleMcpApp, request),
    importMcpFromApps: () => ipcRenderer.invoke(MCP_CHANNELS.importMcpFromApps),
    validateMcpCommand: (command) => ipcRenderer.invoke(MCP_CHANNELS.validateMcpCommand, command),
    getClaudeMcpStatus: () => ipcRenderer.invoke(MCP_CHANNELS.getClaudeMcpStatus),
    readAgentMcpConfig: (agent_id) => ipcRenderer.invoke(MCP_CHANNELS.readAgentMcpConfig, agent_id),
    scanUnmanagedMcp: () => ipcRenderer.invoke(MCP_CHANNELS.scanUnmanagedMcp),
    importSelectedMcp: (request) => ipcRenderer.invoke(MCP_CHANNELS.importSelectedMcp, request),
  },
  sync: {
    getConfig: () => ipcRenderer.invoke(SYNC_CHANNELS.getConfig),
    testConnection: (args) => ipcRenderer.invoke(SYNC_CHANNELS.testConnection, args),
    saveConfig: (args) => ipcRenderer.invoke(SYNC_CHANNELS.saveConfig, args),
    syncUpload: () => ipcRenderer.invoke(SYNC_CHANNELS.syncUpload),
    syncDownload: () => ipcRenderer.invoke(SYNC_CHANNELS.syncDownload),
    fetchRemoteInfo: () => ipcRenderer.invoke(SYNC_CHANNELS.fetchRemoteInfo),
  },
  ws: {
    getWsStatus: () => ipcRenderer.invoke(WS_CHANNELS.getWsStatus),
    toggleWs: (enabled) => ipcRenderer.invoke(WS_CHANNELS.toggleWs, { enabled }),
  },
  proxy: {
    listProxies: () => ipcRenderer.invoke(PROXY_CHANNELS.listProxies),
    createProxy: (req) => ipcRenderer.invoke(PROXY_CHANNELS.createProxy, req),
    updateProxy: (id, patch) => ipcRenderer.invoke(PROXY_CHANNELS.updateProxy, { id, patch }),
    deleteProxy: (id) => ipcRenderer.invoke(PROXY_CHANNELS.deleteProxy, { id }),
    importProxies: (text) => ipcRenderer.invoke(PROXY_CHANNELS.importProxies, { text }),
    testProxy: (id) => ipcRenderer.invoke(PROXY_CHANNELS.testProxy, { id }),
    testProxies: (ids, concurrency) =>
      ipcRenderer.invoke(PROXY_CHANNELS.testProxies, { ids, concurrency }),
    listBindings: () => ipcRenderer.invoke(PROXY_CHANNELS.listBindings),
    getAccountBinding: (accountId) =>
      ipcRenderer.invoke(PROXY_CHANNELS.getAccountBinding, { accountId }),
    bindAccountToProxy: (accountId, proxyId) =>
      ipcRenderer.invoke(PROXY_CHANNELS.bindAccountToProxy, { accountId, proxyId }),
    unbindAccount: (accountId) =>
      ipcRenderer.invoke(PROXY_CHANNELS.unbindAccount, { accountId }),
  },
  apiProxy: {
    start: () => ipcRenderer.invoke(API_PROXY_CHANNELS.start),
    stop: () => ipcRenderer.invoke(API_PROXY_CHANNELS.stop),
    getStatus: () => ipcRenderer.invoke(API_PROXY_CHANNELS.getStatus),
    clearAccountSuspension: (accountId: string) => ipcRenderer.invoke(API_PROXY_CHANNELS.clearAccountSuspension, accountId),
    createClientKey: (name: string) => ipcRenderer.invoke(API_PROXY_CHANNELS.createClientKey, name),
    listClientKeys: () => ipcRenderer.invoke(API_PROXY_CHANNELS.listClientKeys),
    setClientKeyActive: (id: string, isActive: boolean) => ipcRenderer.invoke(API_PROXY_CHANNELS.setClientKeyActive, id, isActive),
    deleteClientKey: (id: string) => ipcRenderer.invoke(API_PROXY_CHANNELS.deleteClientKey, id),
    getAccountPoolHealth: () => ipcRenderer.invoke(API_PROXY_CHANNELS.getAccountPoolHealth),
    getRequestLog: (limit?: number) => ipcRenderer.invoke(API_PROXY_CHANNELS.getRequestLog, limit),
    clearRequestLog: () => ipcRenderer.invoke(API_PROXY_CHANNELS.clearRequestLog),
    onRequestLog: (cb: (record: ProxyRequestRecord) => void) => {
      const listener = (_e: unknown, record: ProxyRequestRecord) => cb(record)
      ipcRenderer.on(API_PROXY_EVENTS.requestLog, listener)
      return () => ipcRenderer.removeListener(API_PROXY_EVENTS.requestLog, listener)
    },
  },
  accountGroup: {
    listGroups: () => ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.listGroups),
    createGroup: (req) => ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.createGroup, req),
    updateGroup: (id, patch) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.updateGroup, { id, patch }),
    deleteGroup: (id, force) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.deleteGroup, { id, force: force ?? false }),
    listMembers: (groupId) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.listMembers, { groupId }),
    listGroupsForAccount: (accountId) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.listGroupsForAccount, { accountId }),
    addMembers: (groupId, accountIds) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.addMembers, { groupId, accountIds }),
    removeMembers: (groupId, accountIds) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.removeMembers, { groupId, accountIds }),
    bindGroupToProxy: (groupId, proxyId) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.bindGroupToProxy, { groupId, proxyId }),
    unbindGroup: (groupId) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.unbindGroup, { groupId }),
    getGroupBinding: (groupId) =>
      ipcRenderer.invoke(ACCOUNT_GROUP_CHANNELS.getGroupBinding, { groupId }),
  },
  sessions: {
    probeTools: () => ipcRenderer.invoke(SESSIONS_CHANNELS.probeTools),
    listSessions: (tool, limit, offset) =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.listSessions, { tool, limit, offset }),
    getMessages: (tool, sourcePath) =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.getMessages, { tool, sourcePath }),
    deleteSession: (tool, sourcePath, sessionId) =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.deleteSession, { tool, sourcePath, sessionId }),
    deleteSessions: (items) => ipcRenderer.invoke(SESSIONS_CHANNELS.deleteSessions, { items }),
    resume: (command, cwd) => ipcRenderer.invoke(SESSIONS_CHANNELS.resume, { command, cwd }),
    repairPreview: () => ipcRenderer.invoke(SESSIONS_CHANNELS.repairPreview),
    repair: (req) => ipcRenderer.invoke(SESSIONS_CHANNELS.repair, req),
    repairRollback: (backupId) => ipcRenderer.invoke(SESSIONS_CHANNELS.repairRollback, { backupId }),
    onRepairProgress: (cb: (p: CodexRepairProgressDto) => void) => {
      const h = (_e: unknown, p: CodexRepairProgressDto) => cb(p)
      ipcRenderer.on(SESSIONS_EVENTS.repairProgress, h)
      return () => ipcRenderer.removeListener(SESSIONS_EVENTS.repairProgress, h)
    },
  },
  activity: {
    syncActivity: () => ipcRenderer.invoke(ACTIVITY_CHANNELS.syncActivity),
    getActivityTrend: (range: string, metric: string) =>
      ipcRenderer.invoke(ACTIVITY_CHANNELS.getActivityTrend, range, metric),
  },
  updater: {
    check: () => ipcRenderer.invoke(UPDATER_CHANNELS.check),
    download: () => ipcRenderer.invoke(UPDATER_CHANNELS.download),
    install: () => ipcRenderer.invoke(UPDATER_CHANNELS.install),
    getStatus: () => ipcRenderer.invoke(UPDATER_CHANNELS.getStatus),
    onStatus: (cb) => {
      const listener = (_e: unknown, status: UpdateStatus) => cb(status)
      ipcRenderer.on(UPDATE_EVENTS.status, listener)
      return () => ipcRenderer.removeListener(UPDATE_EVENTS.status, listener)
    },
  },
  clientConfig: {
    clients: () => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.clients),
    list: (clientId) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.list, clientId),
    create: (input) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.create, input),
    update: (id, patch) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.update, id, patch),
    delete: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.delete, id),
    preview: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.preview, id),
    previewDraft: (input) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.previewDraft, input),
    fetchModels: (input) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.fetchModels, input),
    apply: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.apply, id),
    clear: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.clear, id),
    enable: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.enable, id),
    disable: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.disable, id),
    setDefault: (clientId, id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.setDefault, clientId, id),
    history: (clientId) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.history, clientId),
    rollback: (clientId, entryId) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.rollback, clientId, entryId),
    connectLocalProxy: (clientId) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.connectLocalProxy, clientId),
    testConnectivity: (id) => ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.testConnectivity, id),
    setCodexRelayInjection: (enabled) =>
      ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.setCodexRelayInjection, enabled),
    setCodexProviderEnabled: (id, enabled) =>
      ipcRenderer.invoke(CLIENT_CONFIG_CHANNELS.setCodexProviderEnabled, id, enabled),
  },
  shellOpen: (target) => ipcRenderer.invoke('shell:open', target),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
}

contextBridge.exposeInMainWorld('api', api)
