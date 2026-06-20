import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { SettingsFileService } from './contexts/settings/infrastructure/settings-file-service'
import { SettingsApplicationService } from './contexts/settings/application/settings-service'
import { appDataDir, dotDir, xdgConfigDir } from './platform/persistence/paths'
import { initDatabase, getEm } from './platform/persistence/database'
import type { Services } from './ipc/registry'

// Agents shared layer — the full 17-adapter registry, built once and injected
// into every consumer (agentService IPC + skill service). Mirrors the agents
// manifest §5 "wire buildAgentRegistry() once".
import { buildAgentRegistry } from './agents/build-registry'
import { AgentRegistryService } from './agents/application/agent-registry-service'

// Account context.
import { MikroOrmAccountRepository } from './contexts/account/infrastructure/mikro-orm-account-repository'
import { RepositoryAccountPlatformLookup } from './contexts/account/infrastructure/account-platform-lookup'
import { AccountApplicationService } from './contexts/account/application/account-service'
import { SwitchService } from './contexts/account/application/switch-service'
import { CodexSwitchLifecycle } from './contexts/account/infrastructure/codex-switch-lifecycle'
import { CodexCredentialRefresher } from './contexts/account/infrastructure/codex-credential-refresher'
import { SwitchOrchestrator } from './contexts/account/application/switch-orchestrator'
import { ActiveDetectionService } from './contexts/account/application/active-detection-service'
import { ValidationService } from './contexts/account/application/validation-service'
import { AccountHealthService } from './contexts/account/application/health-service'
import { TokenRefreshScheduler } from './contexts/account/application/token-refresh-scheduler'
import { PlatformQuotaScheduler } from './contexts/quota/application/platform-quota-scheduler'
import { AgentCredentialInjectorRegistry } from './agents/credential-injection/injector-registry'
import { loadOrCreateMasterKey, CryptoService } from './platform/crypto/crypto-service'

// Credential context — owns the authoritative `credentials` store + OAuth/import
// /validation services. Its MikroOrmCredentialRepository implements the account
// CredentialStorePort + the quota QuotaCredentialStore (drop-in replacement for
// the deleted account TEMP MikroOrmCredentialStore).
import { buildCredentialRegistry } from './contexts/credential/infrastructure/build-registry'
import { MikroOrmCredentialRepository } from './contexts/credential/infrastructure/mikro-orm-credential-repository'
import { MikroOrmPendingOAuthRepository } from './contexts/credential/infrastructure/mikro-orm-pending-oauth-repository'
import { MikroOrmPendingImportRepository } from './contexts/credential/infrastructure/mikro-orm-pending-import-repository'
import { OAuthService } from './contexts/credential/application/oauth-service'
import { ImportService } from './contexts/credential/application/import-service'
import { ValidationService as CredentialValidationService } from './contexts/credential/application/validation-service'
// Quota context.
import { MikroOrmQuotaCacheRepository } from './contexts/quota/infrastructure/mikro-orm-quota-cache-repository'
import { MikroOrmQuotaStateRepository } from './contexts/quota/infrastructure/mikro-orm-quota-state-repository'
import { HttpLiveQuotaFetcher } from './contexts/quota/infrastructure/http/http-live-quota-fetcher'
import { QuotaApplicationService } from './contexts/quota/application/quota-service'

// Skill context.
import { MikroOrmInstalledSkillRepository } from './contexts/skill/infrastructure/mikro-orm-installed-skill-repository'
import { MikroOrmSkillRepoRepository } from './contexts/skill/infrastructure/mikro-orm-skill-repo-repository'
import { MikroOrmSkillBackupRepository } from './contexts/skill/infrastructure/mikro-orm-skill-backup-repository'
import { SkillApplicationService } from './contexts/skill/application/skill-application-service'
import { DiscoveryService } from './contexts/skill/application/discovery-service'
import { BackupService } from './contexts/skill/application/backup-service'
import { StorageService } from './contexts/skill/application/storage-service'

// Usage context.
import { MikroOrmUsageFileCursorStore } from './contexts/usage/infrastructure/mikro-orm-usage-file-cursor-store'
import { UsageSyncService } from './contexts/usage/application/usage-sync-service'

// analytics context — unified usage statistics (usage_events single table).
import { MikroOrmUsageEventRepository } from './contexts/analytics/infrastructure/mikro-orm-usage-event-repository'
import { MikroOrmPricingRepository } from './contexts/analytics/infrastructure/mikro-orm-pricing-repository'
import { UsageEventIngestService } from './contexts/analytics/application/usage-event-ingest-service'
import { UsageEventQueryService } from './contexts/analytics/application/usage-event-query-service'
import { PricingService } from './contexts/analytics/application/pricing-service'
import { seedModelPricing } from './contexts/analytics/infrastructure/pricing-seed'
import { InMemoryAgentRegistry } from './agents/shared/agent-registry'
import { ClaudeAgentClient } from './agents/claude/claude-agent'
import { CodexAgentClient } from './agents/codex/codex-agent'
import { GeminiCliAgentClient } from './agents/gemini-cli/gemini-cli-agent'
import { KiroAgentClient } from './agents/kiro/kiro-agent'
import { QoderAgentClient } from './agents/qoder/qoder-agent'

// LocalBackup context.
import { LocalBackupApplicationService } from './contexts/localBackup/application/local-backup-service'
import { LocalBackupConfigAdapter } from './contexts/localBackup/infrastructure/local-backup-config-adapter'

// MCP context.
import { McpApplicationService } from './contexts/mcp/application/mcp-application-service'
import { MikroOrmMcpServerRepository } from './contexts/mcp/infrastructure/mikro-orm-mcp-server-repository'

// Sync context (WebDAV E2EE).
import { SyncApplicationService } from './contexts/sync/application/sync-application-service'
import { MikroOrmSqlDatabase } from './contexts/sync/infrastructure/mikro-orm-sql-database'
import { FetchWebDavClient } from './contexts/sync/infrastructure/fetch-webdav-client'
import { KeychainMasterKeyStore } from './contexts/sync/infrastructure/keychain-master-key-store'
import { SafeStorageSecretStore } from './contexts/sync/infrastructure/secret-store'
import { defaultSsotRoot } from './contexts/skill/application/skill-application-service'

// apiProxy context — local AI API reverse-proxy HTTP service
// (M2b: 中间件链 + 三协议路由 + Echo 占位上游)。
import { ApiHttpServer } from './contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener } from './contexts/apiProxy/infrastructure/http/hono-app'
import { SystemProxyResolver } from './platform/net/system-proxy'
import { session } from 'electron'
import { ClientConfigProfileRepository } from './contexts/clientConfig/infrastructure/client-config-profile.repository'
import { WriterRegistry } from './contexts/clientConfig/application/writer-registry'
import { ClientConfigApplier } from './contexts/clientConfig/application/client-config-applier'
import { ClientConfigService } from './contexts/clientConfig/application/client-config-service'
import { ClientVersionService } from './contexts/clientConfig/application/client-version-service'
import { ConfigSnapshotStore } from './contexts/clientConfig/infrastructure/config-snapshot'
import { ClaudeWriter } from './contexts/clientConfig/infrastructure/writers/claude-writer'
import { GeminiWriter } from './contexts/clientConfig/infrastructure/writers/gemini-writer'
import { OpenCodeWriter } from './contexts/clientConfig/infrastructure/writers/opencode-writer'
import { CodexWriter } from './contexts/clientConfig/infrastructure/writers/codex-writer'
import { createCodexProcessControl } from './contexts/clientConfig/infrastructure/codex-process'
import { CodexAppLifecycle } from './contexts/clientConfig/infrastructure/codex-app-lifecycle'
import { OpenClawWriter } from './contexts/clientConfig/infrastructure/writers/openclaw-writer'
import { HermesWriter } from './contexts/clientConfig/infrastructure/writers/hermes-writer'
import type { LocalProxyPort } from './contexts/clientConfig/application/local-proxy-port'
import type { RelayProvisioningPort } from './contexts/clientConfig/application/relay-provisioning-port'
import { ApiProxyService } from './contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from './contexts/apiProxy/infrastructure/platform-registry'
import { makePlatformAliasResolver } from './contexts/apiProxy/domain/platform-alias'
import { RouteComboRepository } from './contexts/apiProxy/infrastructure/route-combo.repository'
import { ComboService } from './contexts/apiProxy/application/combo-service'
import { COMBO_MODEL_PREFIX } from './contexts/apiProxy/domain/route-combo'
import { RelayInjectionKeyService } from './contexts/apiProxy/application/relay-injection-key-service'
import { ResponsesStore } from './contexts/apiProxy/infrastructure/responses-store/responses-store'
import { ApiProxyKeyRepository } from './contexts/apiProxy/infrastructure/api-proxy-key.repository'
import { ApiProxyKeyService } from './contexts/apiProxy/application/api-proxy-key-service'
import { migrateClientKeys } from './contexts/apiProxy/application/migrate-client-keys'
import { KeyRateLimiter } from './contexts/apiProxy/domain/key-rate-limiter'
import { loadOrCreateCert } from './contexts/apiProxy/infrastructure/http/self-signed-cert'
// KiroAdapter（'kiro' 上游）+ 窄 port 类型 + account port factory。
import { KiroAdapter } from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { PromptCacheTracker } from './contexts/apiProxy/domain/usage/prompt-cache-tracker'
import { KiroUpstreamClient } from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { AccountHealthTracker } from './contexts/apiProxy/domain/account-selection/account-health-tracker'
import { AccountPoolSelector } from './contexts/apiProxy/domain/account-selection/account-pool-selector'
import { ProxyRequestLog } from './contexts/apiProxy/domain/observability/proxy-request-log'
import { MikroOrmRoutingObservabilityRepository } from './contexts/apiProxy/infrastructure/observability/mikro-orm-routing-observability.repository'
import { RoutingObservabilityService } from './contexts/apiProxy/application/routing-observability-service'
import { ProxyPoolRepository } from './contexts/apiProxy/infrastructure/account-pool/proxy-pool.repository'
import { ProxyPoolService } from './contexts/apiProxy/application/proxy-pool-service'
import {
  renderPrometheus,
  type AccountStateTally,
} from './contexts/apiProxy/domain/observability/prometheus'
import { FailoverAdapter } from './contexts/apiProxy/domain/account-selection/failover-adapter'
import { KiroModelCatalog } from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-catalog'
import { ConversationIdCache } from './contexts/apiProxy/domain/account-selection/conversation-id-cache'
import { makeKiroAccountPort } from './container-helpers/kiro-account-port-factory'
import { buildAccountCapabilityRegistry } from './container-helpers/account-capability-registry'
import { createKiroTokenRefresher } from './container-helpers/kiro-token-refresher'
import { makeQuotaResetResolver } from './container-helpers/quota-reset-resolver'
import type {
  KiroCredentialPort,
  KiroDispatcherPort,
  KiroCredential,
} from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
// Proxy context — outbound proxy IP management. ProxyResolver is injected into
// QuotaService so per-account quota fetches route through the bound proxy.
import { MikroOrmProxyRepository } from './contexts/proxy/infrastructure/mikro-orm-proxy-repository'
import { ProxyDispatcherFactory } from './contexts/proxy/infrastructure/proxy-dispatcher-factory'
import {
  ProxyResolver,
  asAccountGroupResolverStore,
} from './contexts/proxy/infrastructure/proxy-resolver'
import { ProxyTester } from './contexts/proxy/infrastructure/proxy-tester'
import { ProxyService } from './contexts/proxy/application/proxy-service'

// Account-group context — cross-platform account groupings + group→proxy binding.
import { MikroOrmAccountGroupRepository } from './contexts/accountGroup/infrastructure/mikro-orm-account-group-repository'
import { AccountGroupService } from './contexts/accountGroup/application/account-group-service'

// Sessions context — read-only on-disk AI CLI conversation history browser.
import { SessionsService } from './contexts/sessions/application/sessions-service'
import { CodexSessionRepair } from './contexts/sessions/application/codex-session-repair'
import { ClaudeSessionSource } from './contexts/sessions/infrastructure/claude-session-source'
import { CodexSessionSource } from './contexts/sessions/infrastructure/codex-session-source'
import { GeminiSessionSource } from './contexts/sessions/infrastructure/gemini-session-source'

// Activity context — 会话活动统计（增量扫描 + 趋势查询）。
import { MikroOrmActivityRepository } from './contexts/activity/infrastructure/mikro-orm-activity-repository'
import { ActivitySyncService } from './contexts/activity/application/activity-sync-service'
import { ActivityQueryService } from './contexts/activity/application/activity-query-service'

// relay 上游注册表 — 第三方中转接入，container 启动时注册 + 热重载。
import { RelayUpstreamRepository } from './contexts/apiProxy/infrastructure/relay/relay-upstream.repository'
import { RelayUpstreamRegistry } from './contexts/apiProxy/infrastructure/relay/relay-upstream-registry'
import { RelayUpstreamClient } from './contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'
import { CodexNativeUpstream } from './contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-upstream'
import { CodexNativeTokenManager } from './contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-token-manager'
import { loadCodexNativeModels } from './contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-models'
import { ResponsesPassthroughUpstream } from './contexts/apiProxy/infrastructure/adapters/relay/responses-passthrough-upstream'

/** Holds lifecycle-managed singletons that main.ts needs beyond the IPC services. */
export interface Container extends Services {
  /** Token-refresh / health-scan scheduler (start on ready, stop on quit). */
  tokenRefreshScheduler: TokenRefreshScheduler
  /** Per-platform quota refresh scheduler (start on ready, stop on quit). */
  platformQuotaScheduler: PlatformQuotaScheduler
  /** 第三方中转上游仓储，供 T5b IPC 做 CRUD。 */
  relayUpstreamRepo: RelayUpstreamRepository
  /**
   * 热重载 relay 适配器：先移除所有 relay-* 平台，再从仓储重建并注册。
   * 供 T5b IPC（增删上游后调用）使用。
   */
  reloadRelayUpstreams: () => Promise<void>
  /** clientConfig relay 桥：按 profileId 建/删 relay 上游并热重载（T8）。 */
  clientConfigRelayProvisioning: RelayProvisioningPort
}

// Builds and wires all service singletons (the Electron equivalent of the
// source AppState). Constructs the database, the shared agents registry, and
// each implemented context's application services.
export async function buildContainer(): Promise<Container> {
  // 1. Settings (file-backed; needed by localBackup config adapter).
  const settingsFile = new SettingsFileService(join(appDataDir(), 'settings.json'))
  await settingsFile.load()
  const settings = new SettingsApplicationService(settingsFile)

  // 2. Database — create the schema (all tables) on first run BEFORE building
  //    any MikroORM-backed repository.
  await initDatabase({ createSchemaOnInit: true })

  // 3. Shared agents registry — the full 17-adapter registry, built once.
  const agentRegistry = buildAgentRegistry()
  const agents = new AgentRegistryService(agentRegistry)

  // 4. Account context (repos + crypto). The credential context owns the
  //    authoritative credential store; its MikroOrmCredentialRepository implements
  //    the account CredentialStorePort (and the quota QuotaCredentialStore), so it
  //    replaces the deleted account TEMP MikroOrmCredentialStore.
  const accountRepo = new MikroOrmAccountRepository()
  const masterKey = await loadOrCreateMasterKey()
  const cryptoService = new CryptoService(masterKey)
  const credentialStore = new MikroOrmCredentialRepository(cryptoService)
  const injectorRegistry = new AgentCredentialInjectorRegistry()
  // Codex 切换的刷新 + 「停-写-启」生命周期：切换前换新过期 OAuth token；
  // 「切换后自动启动」开启时先停运行中的 Codex App、写完按启动路径拉起
  // （codexProcessControl 同时供 clientConfig 的写盘生命周期复用，见下）。
  const codexProcessControl = createCodexProcessControl()
  const codexSwitchLifecycle = new CodexSwitchLifecycle(
    codexProcessControl,
    () => settings.getCodexLaunchOnSwitch(),
    () => settings.getIdePath('codex'),
  )
  const codexCredentialRefresher = new CodexCredentialRefresher()
  const switchService = new SwitchService(
    credentialStore,
    injectorRegistry,
    { refresher: (p) => (p === 'codex' ? codexCredentialRefresher : undefined) },
    { lifecycle: (p) => (p === 'codex' ? codexSwitchLifecycle : undefined) },
  )
  const account = new AccountApplicationService(accountRepo, credentialStore, switchService)
  const accountSwitchOrchestrator = new SwitchOrchestrator(
    accountRepo,
    credentialStore,
    injectorRegistry,
  )
  const platformLookup = new RepositoryAccountPlatformLookup(accountRepo)

  // 4b. Credential context — OAuth / import / validation services. The
  //     OAuthService uses the platform OAuth capabilities (loopback/poll/device)
  //     registered in buildCredentialRegistry; validation reuses the credential
  //     store's envelopes. credentialStore (above) doubles as its repository.
  const credentialRegistry = buildCredentialRegistry(cryptoService, () =>
    settings.getRequireOnlineIdentityCheck('kiro'),
  )
  const pendingOAuthRepo = new MikroOrmPendingOAuthRepository()
  const pendingImportRepo = new MikroOrmPendingImportRepository()
  void pendingImportRepo // reserved for the deep-link confirm flow (manifest §8)
  const credentialOAuth = new OAuthService(credentialRegistry, pendingOAuthRepo)
  const credentialImport = new ImportService(credentialRegistry)
  const credentialValidation = new CredentialValidationService(credentialStore, credentialRegistry)

  // Reverse-detect which account each IDE is actually logged into (reuses the
  // credential import's local scanners), rewriting accounts.is_active to match.
  const accountActiveDetection = new ActiveDetectionService(accountRepo, credentialImport)

  // 4c. Quota context — cache/state repos + live HTTP fetcher + application
  //     service. Depends on the account repo + credential store built above.
  //     The proxy ProxyResolver (built here) is injected so per-account quota
  //     fetches route through the account's bound proxy dispatcher.
  const proxyRepo = new MikroOrmProxyRepository(cryptoService)
  const proxyDispatcherFactory = new ProxyDispatcherFactory()
  const proxyTester = new ProxyTester(proxyDispatcherFactory)
  const proxyService = new ProxyService(proxyRepo, proxyTester)

  // 4c-bis. Account-group context — cross-platform account groupings + per-group
  //   proxy binding. The proxy resolver below reads its proxy bindings to override
  //   the per-account binding at routing time.
  const accountGroupRepo = new MikroOrmAccountGroupRepository()
  const accountGroupService = new AccountGroupService(accountGroupRepo)

  // ProxyResolver depends on both proxyRepo (for proxies + proxy-groups) AND
  // accountGroupRepo (for account-group → proxy bindings). Built AFTER both
  // repos exist so it can fall back from per-account binding to group binding.
  const proxyResolver = new ProxyResolver(
    proxyRepo,
    proxyDispatcherFactory,
    asAccountGroupResolverStore(accountGroupRepo),
  )

  const quotaCacheRepo = new MikroOrmQuotaCacheRepository()
  const quotaStateRepo = new MikroOrmQuotaStateRepository()
  // 启动孤儿清理：正常删除有 FK cascade 兜底，但本地备份回放在 foreign_keys=OFF
  // 的事务里执行，可能回灌已删账号的 quota 行。失败不致命。
  try {
    const pruned = (await quotaStateRepo.pruneOrphans()) + (await quotaCacheRepo.pruneOrphans())
    if (pruned > 0) console.info(`[quota] 启动清理孤儿 quota 行 ${pruned} 条`)
  } catch (e) {
    console.warn('[quota] 孤儿 quota 行清理失败（忽略）：', e)
  }
  const quotaFetcher = new HttpLiveQuotaFetcher()
  const quotaService = new QuotaApplicationService(
    accountRepo,
    credentialStore,
    quotaCacheRepo,
    quotaStateRepo,
    quotaFetcher,
    undefined,
    proxyResolver,
  )

  // 4d. Account validation / health — wired to the REAL capability registry
  //     (credential validator + quota service), replacing NULL_PROVIDER_REGISTRY
  //     (quota manifest §5b).
  const accountCapabilityRegistry = buildAccountCapabilityRegistry(
    credentialValidation,
    quotaService,
  )
  const accountValidation = new ValidationService(accountCapabilityRegistry, platformLookup)
  const accountHealth = new AccountHealthService(
    accountValidation,
    accountCapabilityRegistry,
    platformLookup,
  )
  const tokenRefreshScheduler = new TokenRefreshScheduler(accountValidation, accountRepo)
  // Per-platform quota scheduler. onRefreshed is wired by main.ts once the
  // BrowserWindow exists (so it can push quota:updated to the renderer).
  const platformQuotaScheduler = new PlatformQuotaScheduler(settings, accountRepo, quotaService)

  // 5. Skill context — depends on the shared agents registry (asSkillsSync).
  const installedSkillRepo = new MikroOrmInstalledSkillRepository()
  const skillRepoRepo = new MikroOrmSkillRepoRepository()
  const skillBackupRepo = new MikroOrmSkillBackupRepository()
  const skillService = new SkillApplicationService(
    installedSkillRepo,
    skillBackupRepo,
    agentRegistry,
  )
  const discoveryService = new DiscoveryService(skillRepoRepo)
  const backupService = new BackupService(installedSkillRepo, skillBackupRepo)
  const storageService = new StorageService()

  // 6. Usage context. UsageSyncService is typed against the lean session-log
  //    registry interface (agents/shared), so it consumes the lean 5-client
  //    registry per the usage manifest §5. (The full registry is structurally
  //    incompatible with that narrower interface — see final integration notes.)
  // per-file 增量游标存储（复用 usage_sync_state 表）。注入 claude/codex（大体量 reader）
  // 与同步服务：reader 据此跳过 mtime 未变的文件，同步服务在 upsert 成功后推进游标。
  const usageFileCursorStore = new MikroOrmUsageFileCursorStore()
  const usageAgentRegistry = new InMemoryAgentRegistry([
    new ClaudeAgentClient(usageFileCursorStore),
    new CodexAgentClient(usageFileCursorStore),
    new GeminiCliAgentClient(),
    new KiroAgentClient(),
    new QoderAgentClient(),
  ])

  // 6b. analytics context — 统一用量统计（usage_events 单表，双源 ingest + 去重）。
  // 先于 usageSync 装配：UsageSyncService 构造注入 analyticsIngest。
  const analyticsEventRepo = new MikroOrmUsageEventRepository()
  const analyticsPricingRepo = new MikroOrmPricingRepository()
  const analyticsIngest = new UsageEventIngestService(analyticsEventRepo, analyticsPricingRepo)
  const analyticsQuery = new UsageEventQueryService(analyticsEventRepo)
  const analyticsPricing = new PricingService(analyticsPricingRepo)
  // seed 定价表（幂等：已存在则跳过）
  seedModelPricing(getEm()).catch((e) => console.error('[analytics] seed pricing failed:', e))
  const usageSync = new UsageSyncService(usageAgentRegistry, analyticsIngest, usageFileCursorStore)

  // 7. LocalBackup context.
  const backupDir = join(homedir(), '.haoxiaoguan', 'backups')
  const liveDbPath = join(appDataDir(), 'haoxiaoguan.db')
  const localBackupConfigAdapter = new LocalBackupConfigAdapter(settingsFile)
  const localBackup = new LocalBackupApplicationService(
    liveDbPath,
    backupDir,
    localBackupConfigAdapter,
  )

  // 8. MCP context — server registry persisted in `mcp_servers`, synced to the
  //    shared agents registry's per-agent config files.
  const mcpRepo = new MikroOrmMcpServerRepository()
  const mcp = new McpApplicationService(mcpRepo, agentRegistry)

  // 9. Sync context (WebDAV E2EE). Exports/imports the whole SQLite DB + SSOT
  //    skills via raw SQL; safeStorage-backed master-key + password stores under
  //    appDataDir(). The KeychainMasterKeyStore reads/writes the SAME
  //    master.key.enc that the crypto service uses, so a recovered key takes
  //    effect after the app:relaunch that main triggers on needsRestart.
  const sync = new SyncApplicationService({
    settingsFile,
    db: new MikroOrmSqlDatabase(),
    client: new FetchWebDavClient(),
    masterKeyStore: new KeychainMasterKeyStore(),
    webdavPasswordStore: new SafeStorageSecretStore(
      join(appDataDir(), 'secrets', 'webdav.password.enc'),
    ),
    syncPasswordStore: new SafeStorageSecretStore(
      join(appDataDir(), 'secrets', 'sync.password.enc'),
    ),
    ssotRoot: defaultSsotRoot(),
  })

  // 11. apiProxy 上下文。监听器绑定 settings 的 apiProxyPort（默认 28788），
  //     端口被占时 ApiHttpServer 自动回退 +1。不在此自启——main.ts 依据
  //     apiProxyEnabled 决定 whenReady 后是否 start()。
  //
  //     循环依赖（listener 需 service，service 又需 server）用方案 B（attachServer）打破，
  //     装配顺序固定：建 registry → 建 service（无 server）→ 建 listener（闭包引用 service）→
  //     建 ApiHttpServer(listener) → service.attachServer(server)。
  const platformRegistry = new PlatformRegistry()
  // 不再注册 Echo 占位上游（'echo'/echo-1/echo-mini 仅测试用 stand-in，生产已有 kiro/relay/codex 真实上游）。

  // KiroAdapter（'kiro'）—— 复用已建的 credentialStore / accountRepo / proxyResolver。
  // 4 个窄 port 用现成实例适配（KiroAdapter 不直接依赖任何 repo 类）。
  const kiroCredentialPort: KiroCredentialPort = {
    async retrieve(accountId: string): Promise<KiroCredential | null> {
      const cred = await credentialStore.retrieve(accountId)
      if (cred === null) return null
      return {
        token: cred.token,
        ...(cred.refreshToken !== undefined ? { refreshToken: cred.refreshToken } : {}),
        ...(cred.expiresAt !== undefined ? { expiresAt: cred.expiresAt } : {}),
        ...(cred.rawMetadata !== undefined ? { rawMetadata: cred.rawMetadata } : {}),
      }
    },
  }
  const kiroAccountPort = makeKiroAccountPort(accountRepo as any)
  // G7 系统代理兜底：无账号/组代理绑定时，按 settings 开关跟随 env / OS 系统代理出站。
  // resolveOsProxy 接 Electron session.resolveProxy（含 macOS 系统设置 / Win 注册表 / PAC）。
  const systemProxyResolver = new SystemProxyResolver({
    resolveOsProxy: async (url) => {
      try {
        return await session.defaultSession.resolveProxy(url)
      } catch {
        return undefined
      }
    },
  })
  const kiroDispatcherPort: KiroDispatcherPort = {
    async dispatcherForAccount(accountId: string) {
      const bound = await proxyResolver.dispatcherForAccount(accountId)
      if (bound !== undefined) return bound
      // 账号/组无绑定：仅当用户启用「跟随系统代理」时才兜底；否则直连。
      if (!settings.getApiProxyFollowSystemProxy()) return undefined
      return systemProxyResolver.resolveDispatcher()
    },
  }
  const kiroTokenRefresher = createKiroTokenRefresher()
  const kiroUpstreamClient = new KiroUpstreamClient({ refresher: kiroTokenRefresher })
  const kiroCacheTracker = new PromptCacheTracker()
  // 反代账号池成员（独立标识）：仅池内账号才进选号候选。启动载入持久化成员到内存。
  // 在 health 之前创建：health 的 429 冷却 resolver 需读池成员的 per-account 覆盖。
  const proxyPoolRepo = new ProxyPoolRepository()
  const proxyPoolService = new ProxyPoolService(proxyPoolRepo)
  await proxyPoolService.load()
  const apiProxyHealth = new AccountHealthTracker({
    baseCooldownMs: settings.getApiProxyBaseCooldownMs(),
    maxBackoffMultiplier: settings.getApiProxyMaxBackoffMultiplier(),
    quotaResetMs: settings.getApiProxyQuotaResetMs(),
    probabilisticRetryChance: settings.getApiProxyProbabilisticRetryChance(),
    // 429 限流冷却（按账号解析）：per-account 覆盖优先（-1=不冷却/>0=自定义 ms），否则用全局默认。
    rateLimitCooldownResolver: (id) => {
      const ov = proxyPoolService.getRateLimitCooldownMs(id)
      if (ov < 0) return 0 // -1：不冷却（立即可再用）
      if (ov > 0) return ov // 自定义 ms
      return settings.getApiProxyRateLimitCooldownMs() // 0：用全局
    },
  })
  const apiProxySelector = new AccountPoolSelector(
    {
      strategy: settings.getApiProxySelectionStrategy(),
      perAccountConcurrency: settings.getApiProxyPerAccountConcurrency(),
      affinityTtlMs: settings.getApiProxyAffinityTtlMs(),
      // per-account 令牌桶：15 req/min，突发上限 15。后续可接 settings 标量化配置。
      tokenBucket: { capacityPerAccount: 15, refillPerMinute: 15 },
    },
    apiProxyHealth,
  )
  const kiroConversationIdCache = new ConversationIdCache({
    ttlMs: 2 * 60 * 60 * 1000,
    maxEntries: 1000,
  })
  const kiroInner = new KiroAdapter({
    client: kiroUpstreamClient,
    cacheTracker: kiroCacheTracker,
    conversationIdCache: kiroConversationIdCache,
    genConversationId: randomUUID,
  })
  // 402 额度耗尽：解析账号下一次配额重置时间（缓存优先 + live 兜底），冷却到那一刻再放行。
  const quotaResetResolver = makeQuotaResetResolver({ quotaService })
  platformRegistry.register(
    new FailoverAdapter({
      inner: kiroInner,
      selector: apiProxySelector,
      health: apiProxyHealth,
      accounts: kiroAccountPort,
      credentials: kiroCredentialPort,
      dispatchers: kiroDispatcherPort,
      maxRetries: settings.getApiProxyMaxRetries(),
      retryDelayMs: settings.getApiProxyRetryDelayMs(),
      isPooled: (id) => proxyPoolService.has(id),
      getPriority: (id) => proxyPoolService.getPriority(id),
      getConcurrency: (id) => proxyPoolService.getConcurrency(id),
      quotaReset: quotaResetResolver,
      // 401/403 token 永久失效 → 移出反代池（写穿落库）。
      removeFromPool: async (id) => {
        console.info(`[apiProxy] token 永久失效，移出反代池: ${id}`)
        await proxyPoolService.setPooled(id, false)
      },
      random: Math.random,
    }),
  )

  // kiro 模型「实时」目录：单一内存快照（启动后台预热 + 手动刷新才重建），按「会员档位最高」的
  // 可用账号调上游 ListAvailableModels（纯替代，拉不到回退硬编码）；服务期严格门控——此刻无可用账号
  // 则不下发 kiro。供 /v1/models、可路由清单与客户端接入目录共用（无账号下发 kiro 会让调用方报错）。
  const kiroModelCatalog = new KiroModelCatalog({
    accounts: kiroAccountPort,
    health: apiProxyHealth,
    credentials: kiroCredentialPort,
    isPooled: (id) => proxyPoolService.has(id),
    fallbackModels: () => kiroInner.listModels(),
    // 收口：只下发 adapter 能路由的模型（保证 /v1/models 列出即可调用）。
    canServe: (id) => kiroInner.supportsModel(id),
  })

  // 第三方中转上游（relay）— DB 已初始化、cryptoService 已建，安全注册。
  const relayUpstreamRepo = new RelayUpstreamRepository(cryptoService)
  const relayUpstreamRegistry = new RelayUpstreamRegistry({
    repository: relayUpstreamRepo,
    client: new RelayUpstreamClient(),
  })
  // 记录当前注册的 relay platform 名，供热重载时精确移除。
  let currentRelayPlatforms: string[] = []
  // responses 第三方透传适配器列表（可变引用，热重载时原地同步；ApiProxyService 直接引用此数组）。
  const responsesPassthroughs: ResponsesPassthroughUpstream[] = []
  for (const adapter of await relayUpstreamRegistry.buildAdapters()) {
    platformRegistry.register(adapter)
    currentRelayPlatforms.push(adapter.platform)
    if (adapter instanceof ResponsesPassthroughUpstream) {
      responsesPassthroughs.push(adapter)
    }
  }

  /** 移除旧 relay-* 适配器，从仓储重建并注册最新列表；同步更新 responses 透传列表。 */
  async function reloadRelayUpstreams(): Promise<void> {
    for (const platform of currentRelayPlatforms) {
      platformRegistry.unregister(platform)
    }
    currentRelayPlatforms = []
    responsesPassthroughs.length = 0
    for (const adapter of await relayUpstreamRegistry.buildAdapters()) {
      platformRegistry.register(adapter)
      currentRelayPlatforms.push(adapter.platform)
      if (adapter instanceof ResponsesPassthroughUpstream) {
        responsesPassthroughs.push(adapter)
      }
    }
  }

  // 原生（ChatGPT 登录账号）上游 codex-native：仅当本机存在 ~/.codex/auth.json 时启用。
  // 读 auth.json 播种 OAuth token、自管刷新（不写 auth.json），把 /v1/responses 的原生模型
  // 原样透传到 chatgpt.com/backend-api/codex/responses。注册进 registry 使原生模型进 /v1/models。
  let codexNative: CodexNativeUpstream | undefined
  if (CodexNativeTokenManager.authPresent()) {
    const codexNativeHttp = new RelayUpstreamClient()
    const codexNativeTokens = new CodexNativeTokenManager({
      store: new SafeStorageSecretStore(join(appDataDir(), 'secrets', 'codex-native-tokens.enc')),
      http: codexNativeHttp,
    })
    codexNative = new CodexNativeUpstream({
      tokens: codexNativeTokens,
      http: codexNativeHttp,
      models: loadCodexNativeModels(),
    })
    platformRegistry.register(codexNative)
  }

  // M5 Key 加密存储：复用已有 cryptoService（不建第二个 master key）。
  const apiProxyKeyRepo = new ApiProxyKeyRepository(cryptoService)
  const apiProxyKeyService = new ApiProxyKeyService(apiProxyKeyRepo)

  // 启动迁移：将 settings 明文 Key 搬入加密表，然后清空 settings 字段（幂等，空则 no-op）。
  await migrateClientKeys(settings.getApiProxyClientKeys(), apiProxyKeyRepo, () => {
    void settings.updateSettings({ api_proxy_client_keys: '' })
  })

  // Responses 有状态持久化（previous_response_id 历史链 + store 落盘），默认目录在 appDataDir()/responses。
  const responsesStore = new ResponsesStore()
  // 请求级可观测性（G3）：环形缓冲 + 累计计数器。注入 service 记录每请求；container 把它接到
  // webContents.send 推前端日志页（main.ts），并作为 /metrics（G10）的计数器源。
  const apiProxyRequestLog = new ProxyRequestLog({ capacity: 500 })
  // 路由日志分析（持久化）：仓储 + 应用服务。每条 G3 记录经 persistSink 入缓冲，由 main.ts 定时 flush 落库。
  // 路由日志重构（observability v2）：统一明细 routing_events + 4 张维度日桶（唯一历史/检索/聚合源）。
  const routingObservabilityService = new RoutingObservabilityService(
    new MikroOrmRoutingObservabilityRepository(),
    {},
    analyticsIngest,
  )
  // 每条 G3 记录经 persistSink 入观测缓冲，由 main.ts 定时 flush 落库（吞错不影响反代主流程）。
  apiProxyRequestLog.setPersistSink((rec) => {
    routingObservabilityService.enqueue(rec)
  })
  // 模型别名解析器（kr→kiro / cx→codex-native / relay-<id> 平台名自身）。闭包到实时注册表，
  // relay 热重载后即时可用。service（组合每跳解析）与 hono（入站 model 前缀解析）共用一份。
  const apiProxyAliasResolver = makePlatformAliasResolver(
    (n) => platformRegistry.get(n) !== undefined,
  )
  // 路由组合（命名的跨供应商降级链）：仓储 + 应用服务（含内存缓存作 ComboSource）。
  // 组合优先级最高、运行时盖过同名上游模型（9router 式），仅禁止组合间重名。
  const routeComboRepo = new RouteComboRepository()
  const comboService = new ComboService(routeComboRepo)
  await comboService.load()
  // 中转注入固定 key（隐藏、不进 client key 列表、仅本地、稳定持久）。启动解析一次：
  // hono 鉴权识别它→标记请求直连真实上游(原生→登录账号)、不走组合；客户端接入做中转注入时注入它。
  const relayInjectionKeyService = new RelayInjectionKeyService(
    new SafeStorageSecretStore(join(appDataDir(), 'secrets', 'relay-injection.key.enc')),
    () => `sk-hxg-relay-${randomUUID().replace(/-/g, '')}`,
  )
  const relayInjectionKey = await relayInjectionKeyService.get()
  const apiProxyService = new ApiProxyService(undefined, {
    registry: platformRegistry,
    responsesStore,
    observability: apiProxyRequestLog,
    ...(codexNative ? { codexNative } : {}),
    responsesPassthroughs,
    combos: comboService,
    kiroModelCatalog,
    resolvePlatformAlias: apiProxyAliasResolver,
    // Phase 2 配额感知跳过：仅 kiro 有账号池健康可视；池内无 available 账号即「确凿不可用」。
    // 账号池健康已反映超额（超额服务中的账号仍 available），故 nEnabled 超额池不会被误跳。
    isPlatformExhausted: async (platform) => {
      if (platform !== 'kiro') return false
      const accts = await kiroAccountPort.listByPlatform()
      if (accts.length === 0) return false
      return apiProxyHealth
        .snapshotAll(accts.map((a) => a.id))
        .every((s) => s.runtimeState !== 'available')
    },
  })
  // 客户端 Key 令牌桶限流器（后续可接 settings 动态配置 capacity/refillPerMinute）。
  const apiProxyKeyRateLimiter = new KeyRateLimiter({ capacity: 10, refillPerMinute: 10 })
  // 若 apiProxyHttps=true，尝试加载/生成自签证书并启用 HTTPS；失败时降级 HTTP 并打警告，不阻断启动。
  let tlsConfig:
    | { tls: import('./contexts/apiProxy/infrastructure/http/self-signed-cert').CertBundle }
    | Record<string, never> = {}
  if (settings.getApiProxyHttps()) {
    try {
      const cert = loadOrCreateCert()
      tlsConfig = { tls: cert }
    } catch (err) {
      console.warn('[container] HTTPS 证书加载失败，降级为 HTTP:', err)
    }
  }
  // Prometheus /metrics（G10）数据源：G3 计数器 + 账号运行态汇总 + inflight + uptime。
  const apiProxyMetrics = async (): Promise<string> => {
    const accts = await kiroAccountPort.listByPlatform()
    const tally: AccountStateTally = { available: 0, cooldown: 0, rate_limited: 0, quota_exhausted: 0, suspended: 0 }
    for (const s of apiProxyHealth.snapshotAll(accts.map((a) => a.id))) tally[s.runtimeState] += 1
    const counters = apiProxyRequestLog.counters()
    const uptimeSeconds =
      counters.startedAtMs === null
        ? 0
        : Math.max(0, Math.floor((Date.now() - counters.startedAtMs) / 1000))
    return renderPrometheus({
      counters,
      uptimeSeconds,
      inflight: apiProxySelector.totalInflight(),
      accountStates: tally,
    })
  }
  const apiHttpServer = new ApiHttpServer(
    createApiRequestListener({
      service: apiProxyService,
      auth: {
        keysProvider: () => apiProxyKeyRepo.listActivePlaintext(),
        allowAnonymousLoopback: settings.getApiProxyAllowAnonymousLoopback(),
      },
      // 模型别名解析器（与 service 共用同一份；闭包到实时注册表，relay 热重载即时可用）。
      resolvePlatformAlias: apiProxyAliasResolver,
      // 中转注入固定 key（仅本地）：带它的请求直连真实上游、不走组合。
      relayInjectionKey,
      keyRateLimiter: apiProxyKeyRateLimiter,
      metrics: apiProxyMetrics,
      // G5 IP 白/黑名单 + G6 请求体上限：闭包读 settings 实时值（运行时改设置即生效）。
      ipAccess: () => ({
        allowlist: settings.getApiProxyIpAllowlist(),
        denylist: settings.getApiProxyIpDenylist(),
      }),
      maxBodyBytes: () => settings.getApiProxyMaxBodyBytes(),
    }),
    { port: settings.getApiProxyPort(), ...tlsConfig },
  )
  apiProxyService.attachServer(apiHttpServer)

  // 启动后台预热 kiro 模型快照（非阻塞）：拉「会员最高」可用账号的 ListAvailableModels 入缓存。
  // 失败不阻断启动（服务期门控会在无账号/无快照时暂以硬编码兜底，待手动刷新或下次预热重建）。
  void kiroModelCatalog.warm().catch(() => {})

  // 客户端接入管理（clientConfig）：把反代/第三方 provider 写进各 CLI 客户端配置。
  // writer 路径经 path-resolver(dotDir) 解析；历史快照存 appDataDir/client-config/history。
  const clientConfigRegistry = new WriterRegistry()
  clientConfigRegistry.register(new ClaudeWriter(join(dotDir('claude'), 'settings.json')))
  clientConfigRegistry.register(
    new GeminiWriter(join(dotDir('gemini'), '.env'), join(dotDir('gemini'), 'settings.json')),
  )
  clientConfigRegistry.register(new OpenCodeWriter(join(xdgConfigDir('opencode'), 'opencode.json')))
  // Codex 桌面 App 停-写-启生命周期：运行中的 Codex App 会按内存反写 config.toml，
  // 必须停 App→写→重启它，改动才会被采纳（osascript 优雅退出，绝不宽泛 pkill；非 macOS 为 no-op）。
  // codexProcessControl 在账号上下文（§4）创建，与切号生命周期/codexSessionRepair 共用一个 control。
  const codexAppLifecycle = new CodexAppLifecycle(codexProcessControl)
  clientConfigRegistry.register(
    new CodexWriter(
      join(dotDir('codex'), 'config.toml'),
      join(appDataDir(), 'client-config', 'codex-model-catalog.json'),
      join(dotDir('codex'), 'auth.json'),
      codexAppLifecycle,
    ),
  )
  clientConfigRegistry.register(new OpenClawWriter(join(dotDir('openclaw'), 'openclaw.json')))
  clientConfigRegistry.register(new HermesWriter(join(dotDir('hermes'), 'config.yaml')))
  const clientConfigSnapshots = new ConfigSnapshotStore({
    baseDir: join(appDataDir(), 'client-config', 'history'),
  })
  // 本机反代接入窄端口（phase3）：读端口/签发 key/吊销/模型清单，接 apiProxy 但不引入循环依赖。
  const clientConfigLocalProxy: LocalProxyPort = {
    getPort: () => {
      const s = apiProxyService.getStatus()
      return s.state === 'running' && s.port !== undefined ? s.port : null
    },
    ensureStarted: async () => {
      // 路由联动：反代已运行直接取端口；未运行则启动后再取（自动开启 API 服务）。
      let s = apiProxyService.getStatus()
      if (!(s.state === 'running' && s.port !== undefined)) {
        await apiProxyService.start()
        s = apiProxyService.getStatus()
      }
      if (s.state !== 'running' || s.port === undefined) {
        throw new Error('API 服务已启动但未就绪（无监听端口）')
      }
      return s.port
    },
    signKey: async (name) => {
      const { meta, plaintext } = await apiProxyKeyService.create(name)
      return { id: meta.id, plaintext }
    },
    revokeKey: (id) => apiProxyKeyService.delete(id),
    getRelayInjectionKey: () => relayInjectionKey,
    // 可路由名清单：账号池/relay 模型 + 启用的路由组合（组合用显式 cb/<name>，可作注入 model）。
    // kiro 走实时快照（无可用账号 → 不出现），其余平台仍取注册表静态清单。
    listModels: () => {
      const seen = new Set<string>()
      const ids: string[] = []
      const push = (id: string): void => {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
      for (const { platform, model } of platformRegistry.listAllModelsWithPlatform()) {
        if (platform === 'kiro') continue
        push(model.id)
      }
      for (const m of kiroModelCatalog.listForServe()) push(m.id)
      for (const c of comboService.list()) {
        if (c.enabled) push(`${COMBO_MODEL_PREFIX}${c.name}`)
      }
      return ids
    },
    listCatalogModels: () => {
      // 按平台排除占位 echo 与原生 codex-native（原生由 Codex 自带 models_cache 提供），
      // 只留账号池 Claude + 第三方 relay。按 id 去重。
      const seen = new Set<string>()
      const out: Array<{ id: string; displayName?: string; contextLength?: number }> = []
      const pushModel = (m: { id: string; displayName?: string; contextLength?: number }): void => {
        if (seen.has(m.id)) return
        seen.add(m.id)
        out.push({
          id: m.id,
          ...(m.displayName !== undefined ? { displayName: m.displayName } : {}),
          ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
        })
      }
      for (const platform of platformRegistry.knownPlatforms()) {
        // kiro 走实时快照（下方单独追加）；echo 占位、codex-native 由 Codex 自带 models_cache 提供。
        if (platform === 'echo' || platform === 'codex-native' || platform === 'kiro') continue
        const adapter = platformRegistry.get(platform)
        if (adapter === undefined) continue
        for (const m of adapter.listModels()) pushModel(m)
      }
      // kiro：实时快照 + 门控（无可用账号 → 不出现）。
      for (const m of kiroModelCatalog.listForServe()) pushModel(m)
      // 启用的路由组合追加为可注入 model：用显式 cb/<name>，与同名上游模型消歧（中转注入下也能寻址）。
      for (const c of comboService.list()) {
        if (!c.enabled) continue
        const id = `${COMBO_MODEL_PREFIX}${c.name}`
        if (seen.has(id)) continue
        seen.add(id)
        out.push({ id, displayName: `${c.name}（组合）` })
      }
      return out
    },
    listAccountPoolModels: () => {
      // 仅账号池(kiro/Claude)模型；relay-* 与 codex-native/echo 不算。
      // 实时快照 + 门控：无可用 kiro 账号 → 返回空（不再下发会让调用方报错的模型）。
      return kiroModelCatalog.listForServe().map((m) => ({
        id: m.id, // slug 保持裸名：带固定注入 key 时裸名直连 kiro，路由不变
        // display_name 强制带「· 号小管账号」标记，让 Codex 等选择器里与原生 GPT/组合一眼可分。
        displayName: `${m.displayName ?? m.id} · 号小管账号`,
        ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
      }))
    },
    listNativeModelSlugs: () => {
      // 原生（ChatGPT 登录账号）模型 slug 列表；供 ON 撞名别名检测。
      if (codexNative === undefined) return []
      return codexNative.listModels().map((m) => m.id)
    },
    listCombos: () =>
      comboService
        .list()
        .filter((c) => c.enabled)
        .map((c) => ({
          id: `${COMBO_MODEL_PREFIX}${c.name}`,
          displayName: `${c.name} · 号小管组合`,
        })),
  }
  // relay 桥（T8）：按 clientConfig 接入档 id 建/删 relay 上游并热重载。
  const clientConfigRelayProvisioning: RelayProvisioningPort = {
    async ensureRelayUpstream(input) {
      const { profileId, displayName, protocol, baseUrl, apiKey, models } = input
      // WireProtocol → relay 上游协议映射。
      // openai-responses：HTTP 级透传，存 'openai-responses'；
      //   models 携带 alias→real 映射（格式 displayName='alias:real'，alias===real 时退 id）。
      // openai-chat/anthropic/gemini：IR 转换路，存规范协议名。
      let relayProtocol: string
      let modelInfos: Array<{ id: string; displayName?: string }>
      if (protocol === 'openai-responses') {
        relayProtocol = 'openai-responses'
        // models 字段：每项 RelayModelAlias { alias, real }（alias 可能等于 real）。
        // ModelInfo.id = alias（catalog slug），displayName = 'alias:real'（供 registry 解析别名）。
        const aliasList = models as Array<string | { alias: string; real: string }>
        modelInfos = aliasList.map((m) => {
          if (typeof m === 'string') return { id: m, displayName: `${m}:${m}` }
          const { alias, real } = m as { alias: string; real: string }
          return { id: alias, displayName: alias === real ? alias : `${alias}:${real}` }
        })
      } else if (protocol === 'openai-chat') {
        relayProtocol = 'openai'
        modelInfos = (models as string[]).map((id) => ({ id, displayName: id }))
      } else if (protocol === 'anthropic') {
        relayProtocol = 'anthropic'
        modelInfos = (models as string[]).map((id) => ({ id, displayName: id }))
      } else if (protocol === 'gemini') {
        relayProtocol = 'gemini'
        modelInfos = (models as string[]).map((id) => ({ id, displayName: id }))
      } else {
        throw new Error(
          `该上游协议暂不支持中转，请直连或选 openai/anthropic/gemini/responses 兼容端点（protocol=${protocol}）`,
        )
      }
      const record = await relayUpstreamRepo.upsertByProfileId(profileId, {
        displayName,
        protocol: relayProtocol,
        baseUrl,
        apiKey,
        models: modelInfos,
      })
      await reloadRelayUpstreams()
      return { platform: `relay-${record.id}` }
    },
    async removeRelayUpstream(profileId) {
      await relayUpstreamRepo.deleteByProfileId(profileId)
      await reloadRelayUpstreams()
    },
  }

  const clientConfigService = new ClientConfigService(
    new ClientConfigProfileRepository(cryptoService),
    clientConfigRegistry,
    new ClientConfigApplier(clientConfigSnapshots),
    clientConfigSnapshots,
    clientConfigLocalProxy,
    clientConfigRelayProvisioning,
    (clientId) => settings.getRoutingEnabled(clientId),
  )
  // 客户端版本/可升级探测（独立 service，带 TTL 缓存；clients() 列表仍走文件检测保持秒开）。
  const clientVersionService = new ClientVersionService()

  // Sessions context — 不落库，惰性扫盘，terminaLaunchTemplate 运行时从 settings 读。
  // logSources 同时注入 sessionsService 与 activitySync，接新 agent 只动这一个数组。
  const logSources = [
    new ClaudeSessionSource(),
    new CodexSessionSource(),
    new GeminiSessionSource(),
  ]
  const sessionsService = new SessionsService(logSources, () =>
    settings.getTerminalLaunchTemplate(),
  )
  const codexSessionRepair = new CodexSessionRepair(
    dotDir('codex'),
    join(dotDir('codex'), 'config.toml'),
    codexAppLifecycle,
    () => codexProcessControl.isRunning(),
    join(appDataDir(), 'session-repair-backups'),
  )

  // Activity context — 复用 logSources，不重建适配器实例。
  const activityRepo = new MikroOrmActivityRepository()
  const activitySync = new ActivitySyncService(logSources, activityRepo)
  const activityQuery = new ActivityQueryService(activityRepo)

  return {
    settings,
    agents,
    account,
    accountSwitchOrchestrator,
    accountValidation,
    accountHealth,
    accountActiveDetection,
    credentialOAuth,
    credentialImport,
    credentialValidation,
    quotaService,
    skillService,
    discoveryService,
    backupService,
    storageService,
    usageSync,
    analyticsQuery,
    analyticsPricing,
    localBackup,
    mcp,
    sync,
    proxyService,
    proxyResolver,
    accountGroupService,
    apiProxyService,
    apiProxyHealth,
    kiroAccountPort,
    kiroModelCatalog,
    apiProxyKeyService,
    apiProxyRequestLog,
    routingObservabilityService,
    proxyPoolService,
    apiProxySelector,
    comboService,
    clientConfigService,
    clientVersionService,
    tokenRefreshScheduler,
    platformQuotaScheduler,
    sessionsService,
    codexSessionRepair,
    activitySync,
    activityQuery,
    relayUpstreamRepo,
    reloadRelayUpstreams,
    clientConfigRelayProvisioning,
  }
}
