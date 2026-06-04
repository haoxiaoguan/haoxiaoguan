import type { SettingsApplicationService } from '../contexts/settings/application/settings-service'
import { registerSettingsHandlers } from '../contexts/settings/ipc/settings-handlers'

import type { AgentRegistryService } from '../agents/application/agent-registry-service'
import { registerAgentHandlers } from '../agents/ipc/agent-handlers'

import type { AccountApplicationService } from '../contexts/account/application/account-service'
import type { SwitchOrchestrator } from '../contexts/account/application/switch-orchestrator'
import type { ValidationService } from '../contexts/account/application/validation-service'
import type { AccountHealthService } from '../contexts/account/application/health-service'
import type { ActiveDetectionService } from '../contexts/account/application/active-detection-service'
import { registerAccountHandlers } from '../contexts/account/ipc/account-handlers'

import type { SkillApplicationService } from '../contexts/skill/application/skill-application-service'
import type { DiscoveryService } from '../contexts/skill/application/discovery-service'
import type { BackupService } from '../contexts/skill/application/backup-service'
import type { StorageService } from '../contexts/skill/application/storage-service'
import { registerSkillHandlers } from '../contexts/skill/ipc/skill-handlers'

import type { UsageSyncService } from '../contexts/usage/application/usage-sync-service'
import type { UsageQueryService } from '../contexts/usage/application/usage-query-service'
import { registerUsageHandlers } from '../contexts/usage/ipc/usage-handlers'

import type { LocalBackupApplicationService } from '../contexts/localBackup/application/local-backup-service'
import { registerLocalBackupHandlers } from '../contexts/localBackup/ipc/local-backup-handlers'

import type { OAuthService } from '../contexts/credential/application/oauth-service'
import type { ImportService } from '../contexts/credential/application/import-service'
import type { ValidationService as CredentialValidationService } from '../contexts/credential/application/validation-service'
import { registerCredentialHandlers } from '../contexts/credential/ipc/credential-handlers'

import type { QuotaApplicationService } from '../contexts/quota/application/quota-service'
import { registerQuotaHandlers } from '../contexts/quota/ipc/quota-handlers'

import type { McpApplicationService } from '../contexts/mcp/application/mcp-application-service'
import { registerMcpHandlers } from '../contexts/mcp/ipc/mcp-handlers'

import type { SyncApplicationService } from '../contexts/sync/application/sync-application-service'
import { registerSyncHandlers } from '../contexts/sync/ipc/sync-handlers'

import type { WebSocketApplicationService } from '../contexts/websocket/application/websocket-service'
import { registerWebSocketHandlers } from '../contexts/websocket/ipc/websocket-handlers'

import type { ProxyService } from '../contexts/proxy/application/proxy-service'
import { registerProxyHandlers } from '../contexts/proxy/ipc/proxy-handlers'
import type { ProxyResolver } from '../contexts/proxy/infrastructure/proxy-resolver'

import type { AccountGroupService } from '../contexts/accountGroup/application/account-group-service'
import { registerAccountGroupHandlers } from '../contexts/accountGroup/ipc/account-group-handlers'

import type { ApiProxyService } from '../contexts/apiProxy/application/api-proxy-service'
import { registerApiProxyHandlers } from '../contexts/apiProxy/ipc/api-proxy-handlers'
import type { AccountHealthTracker } from '../contexts/apiProxy/domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { ApiProxyKeyService } from '../contexts/apiProxy/application/api-proxy-key-service'

// The service singletons built by buildContainer(). Each implemented context
// contributes its application services; the IPC layer registers handlers that
// delegate to them.
//
// All nine contexts are wired. The only renderer methods still on the throwing
// tauriInvoke shim are the websocket toggle/status pair (get_ws_status /
// toggle_ws), which belong to a websocket context not yet built.
export interface Services {
  settings: SettingsApplicationService
  agents: AgentRegistryService

  // account context (+ health / switch-v2)
  account: AccountApplicationService
  accountSwitchOrchestrator: SwitchOrchestrator
  accountValidation: ValidationService
  accountHealth: AccountHealthService
  accountActiveDetection: ActiveDetectionService

  // credential context (OAuth / import / envelope-aware validation)
  credentialOAuth: OAuthService
  credentialImport: ImportService
  credentialValidation: CredentialValidationService

  // quota context
  quotaService: QuotaApplicationService

  // skill context
  skillService: SkillApplicationService
  discoveryService: DiscoveryService
  backupService: BackupService
  storageService: StorageService

  // usage context
  usageSync: UsageSyncService
  usageQuery: UsageQueryService

  // localBackup context
  localBackup: LocalBackupApplicationService

  // mcp context
  mcp: McpApplicationService

  // sync context (WebDAV E2EE)
  sync: SyncApplicationService

  // websocket push-server context
  websocket: WebSocketApplicationService

  // proxy context (outbound proxy IP management)
  proxyService: ProxyService
  proxyResolver: ProxyResolver

  // account-group context (cross-platform account groupings + group→proxy binding)
  accountGroupService: AccountGroupService

  // apiProxy context (local AI API reverse-proxy HTTP service)
  apiProxyService: ApiProxyService
  /** 账号运行态健康跟踪（供 T10 IPC 手动解除挂起用）。 */
  apiProxyHealth: AccountHealthTracker
  /** Kiro 账号 port（供 T10 IPC 持久化 clearSuspension 用）。 */
  kiroAccountPort: KiroAccountPort
  /** 客户端 Key 管理（可选，Task 6 container 注入后激活 IPC handler）。 */
  apiProxyKeyService?: ApiProxyKeyService
}

// Each context contributes a register*Handlers function.
export function registerAllHandlers(services: Services): void {
  registerSettingsHandlers(services.settings)
  registerAgentHandlers(services.agents)
  registerAccountHandlers({
    accountService: services.account,
    switchOrchestrator: services.accountSwitchOrchestrator,
    validationService: services.accountValidation,
    healthService: services.accountHealth,
    activeDetection: services.accountActiveDetection,
  })
  registerCredentialHandlers({
    oauthService: services.credentialOAuth,
    importService: services.credentialImport,
    validationService: services.credentialValidation,
    proxyResolver: services.proxyResolver,
  })
  registerQuotaHandlers(services.quotaService)
  registerSkillHandlers({
    skillService: services.skillService,
    discoveryService: services.discoveryService,
    backupService: services.backupService,
    storageService: services.storageService,
  })
  registerUsageHandlers(services.usageSync, services.usageQuery)
  registerLocalBackupHandlers(services.localBackup)
  registerMcpHandlers(services.mcp)
  registerSyncHandlers(services.sync)
  registerWebSocketHandlers(services.websocket)
  registerProxyHandlers(services.proxyService)
  registerAccountGroupHandlers(services.accountGroupService)
  registerApiProxyHandlers(services.apiProxyService, services.apiProxyHealth, services.kiroAccountPort, services.apiProxyKeyService, services.settings.getApiProxyQuotaResetMs())
}
