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
import type { UsageEventQueryService } from '../contexts/analytics/application/usage-event-query-service'
import type { UsageEventIngestService } from '../contexts/analytics/application/usage-event-ingest-service'
import type { PricingService } from '../contexts/analytics/application/pricing-service'
import { registerAnalyticsHandlers } from '../contexts/analytics/ipc/analytics-handlers'

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

import type { ProxyService } from '../contexts/proxy/application/proxy-service'
import { registerProxyHandlers } from '../contexts/proxy/ipc/proxy-handlers'
import type { ProxyResolver } from '../contexts/proxy/infrastructure/proxy-resolver'

import type { AccountGroupService } from '../contexts/accountGroup/application/account-group-service'
import { registerAccountGroupHandlers } from '../contexts/accountGroup/ipc/account-group-handlers'

import type { ApiProxyService } from '../contexts/apiProxy/application/api-proxy-service'
import { registerApiProxyHandlers } from '../contexts/apiProxy/ipc/api-proxy-handlers'
import type { ComboService } from '../contexts/apiProxy/application/combo-service'
import type { AccountHealthTracker } from '../contexts/apiProxy/domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { KiroModelCatalog } from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-catalog'
import type { ApiProxyKeyService } from '../contexts/apiProxy/application/api-proxy-key-service'
import type { ProxyRequestLog } from '../contexts/apiProxy/domain/observability/proxy-request-log'
import type { RoutingObservabilityService } from '../contexts/apiProxy/application/routing-observability-service'
import { registerRoutingObservabilityHandlers } from '../contexts/apiProxy/ipc/routing-observability-handlers'
import type { ProxyPoolService } from '../contexts/apiProxy/application/proxy-pool-service'
import type { AccountPoolSelector } from '../contexts/apiProxy/domain/account-selection/account-pool-selector'
import { registerProxyPoolConfigHandlers } from '../contexts/apiProxy/ipc/proxy-pool-config-handlers'

import type { SessionsService } from '../contexts/sessions/application/sessions-service'
import { registerSessionsHandlers } from '../contexts/sessions/ipc/sessions-handlers'
import type { CodexSessionRepair } from '../contexts/sessions/application/codex-session-repair'

import { registerActivityHandlers } from '../contexts/activity/ipc/activity-handlers'
import type { ClientConfigService } from '../contexts/clientConfig/application/client-config-service'
import type { ClientVersionService } from '../contexts/clientConfig/application/client-version-service'
import { registerClientConfigHandlers } from '../contexts/clientConfig/ipc/client-config-handlers'
import type { ActivitySyncService } from '../contexts/activity/application/activity-sync-service'
import type { ActivityQueryService } from '../contexts/activity/application/activity-query-service'

// The service singletons built by buildContainer(). Each implemented context
// contributes its application services; the IPC layer registers handlers that
// delegate to them.
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
  analyticsQuery: UsageEventQueryService
  analyticsPricing: PricingService
  analyticsIngest: UsageEventIngestService

  // localBackup context
  localBackup: LocalBackupApplicationService

  // mcp context
  mcp: McpApplicationService

  // sync context (WebDAV E2EE)
  sync: SyncApplicationService

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
  /** kiro 模型实时目录（单一快照）。供 IPC「手动刷新模型」调用 refresh()。 */
  kiroModelCatalog: KiroModelCatalog
  /** 客户端 Key 管理（可选，Task 6 container 注入后激活 IPC handler）。 */
  apiProxyKeyService?: ApiProxyKeyService
  /** 请求级可观测性日志（G3）：实时推送 + Prometheus 计数（历史/查询走 routingObservabilityService）。 */
  apiProxyRequestLog: ProxyRequestLog
  /**
   * 路由日志重构（observability v2）：统一明细 routing_events + 4 张维度日桶 + 实时/检索/聚合查询。
   */
  routingObservabilityService: RoutingObservabilityService
  /** 反代账号池成员（独立标识；仅池内账号可被反代选号）。 */
  proxyPoolService: ProxyPoolService
  /** 反代选号器（供「反代设置」运行时热更轮询策略/亲密度/并发）。 */
  apiProxySelector: AccountPoolSelector
  /** 路由组合服务（CRUD + ComboSource）。 */
  comboService?: ComboService

  // sessions context (read-only on-disk AI CLI conversation history browser)
  sessionsService: SessionsService
  codexSessionRepair: CodexSessionRepair

  // activity context (session activity stats — incremental scan + trend query)
  activitySync: ActivitySyncService
  activityQuery: ActivityQueryService

  // client-config context (write reverse-proxy / third-party provider into CLI clients)
  clientConfigService: ClientConfigService
  clientVersionService: ClientVersionService
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
  registerAnalyticsHandlers(services.analyticsQuery, services.analyticsPricing)
  registerLocalBackupHandlers(services.localBackup)
  registerMcpHandlers(services.mcp)
  registerSyncHandlers(services.sync)
  registerProxyHandlers(services.proxyService)
  registerAccountGroupHandlers(services.accountGroupService)
  registerApiProxyHandlers(
    services.apiProxyService,
    services.apiProxyHealth,
    services.kiroAccountPort,
    services.apiProxyKeyService,
    services.settings.getApiProxyQuotaResetMs(),
    services.comboService,
    services.proxyPoolService,
    services.routingObservabilityService,
    () => services.kiroModelCatalog.refresh(),
  )
  registerProxyPoolConfigHandlers({
    selector: services.apiProxySelector,
    settings: services.settings,
  })
  registerRoutingObservabilityHandlers(services.routingObservabilityService)
  registerSessionsHandlers(
    services.sessionsService,
    services.codexSessionRepair,
    services.clientConfigService,
  )
  registerActivityHandlers(services.activitySync, services.activityQuery)
  registerClientConfigHandlers(services.clientConfigService, services.clientVersionService)
}
