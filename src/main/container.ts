import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { SettingsFileService } from './contexts/settings/infrastructure/settings-file-service'
import { SettingsApplicationService } from './contexts/settings/application/settings-service'
import { appDataDir } from './platform/persistence/paths'
import { initDatabase } from './platform/persistence/database'
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
import { SwitchOrchestrator } from './contexts/account/application/switch-orchestrator'
import { ActiveDetectionService } from './contexts/account/application/active-detection-service'
import { ValidationService } from './contexts/account/application/validation-service'
import { AccountHealthService } from './contexts/account/application/health-service'
import { TokenRefreshScheduler } from './contexts/account/application/token-refresh-scheduler'
import { PlatformQuotaScheduler } from './contexts/quota/application/platform-quota-scheduler'
import type {
  ProviderCapabilityRegistry,
  ValidationCapability,
  QuotaCapability,
  CredentialValidationResult as AccountValidationResult,
  QuotaFetchResult as AccountQuotaFetchResult,
} from './contexts/account/application/capability-ports'
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
import { validationResultToJson } from './contexts/credential/domain/capability-types'

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
import { MikroOrmUsageRecordRepository } from './contexts/usage/infrastructure/mikro-orm-usage-record-repository'
import { MikroOrmUsageRollupRepository } from './contexts/usage/infrastructure/mikro-orm-usage-rollup-repository'
import { MikroOrmUsageSyncStateRepository } from './contexts/usage/infrastructure/mikro-orm-usage-sync-state-repository'
import { UsageSyncService } from './contexts/usage/application/usage-sync-service'
import { UsageQueryService } from './contexts/usage/application/usage-query-service'
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

// WebSocket push-server context.
import { WsServer } from './platform/websocket/ws-server'
import { WebSocketApplicationService } from './contexts/websocket/application/websocket-service'

// apiProxy context — local AI API reverse-proxy HTTP service
// (M2b: 中间件链 + 三协议路由 + Echo 占位上游)。
import { ApiHttpServer } from './contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener } from './contexts/apiProxy/infrastructure/http/hono-app'
import { ApiProxyService } from './contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from './contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from './contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import { ResponsesStore } from './contexts/apiProxy/infrastructure/responses-store/responses-store'
import { ApiProxyKeyRepository } from './contexts/apiProxy/infrastructure/api-proxy-key.repository'
import { ApiProxyKeyService } from './contexts/apiProxy/application/api-proxy-key-service'
import { migrateClientKeys } from './contexts/apiProxy/application/migrate-client-keys'
import { KeyRateLimiter } from './contexts/apiProxy/domain/key-rate-limiter'
// KiroAdapter（'kiro' 上游）+ 窄 port 类型 + account port factory。
import { KiroAdapter } from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { PromptCacheTracker } from './contexts/apiProxy/domain/usage/prompt-cache-tracker'
import { KiroUpstreamClient } from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { AccountHealthTracker } from './contexts/apiProxy/domain/account-selection/account-health-tracker'
import { AccountPoolSelector } from './contexts/apiProxy/domain/account-selection/account-pool-selector'
import { FailoverAdapter } from './contexts/apiProxy/domain/account-selection/failover-adapter'
import { ConversationIdCache } from './contexts/apiProxy/domain/account-selection/conversation-id-cache'
import { makeKiroAccountPort } from './container-helpers/kiro-account-port-factory'
import type {
  KiroCredentialPort,
  KiroDispatcherPort,
  KiroTokenRefresher,
  KiroCredential,
  RefreshedKiroToken,
} from './contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
// 号小管 Kiro 身份 helper —— token 刷新 + auth-method/region/profileArn 解析（与额度路径同源）。
import {
  refreshKiroToken,
  resolveKiroAuthMethod,
  normalizeRegion,
  parseRegionFromArn,
  defaultProfileArnFor,
} from './platform/net/kiro/kiro-identity-client'

// Proxy context — outbound proxy IP management. ProxyResolver is injected into
// QuotaService so per-account quota fetches route through the bound proxy.
import { MikroOrmProxyRepository } from './contexts/proxy/infrastructure/mikro-orm-proxy-repository'
import { ProxyDispatcherFactory } from './contexts/proxy/infrastructure/proxy-dispatcher-factory'
import { ProxyResolver, asAccountGroupResolverStore } from './contexts/proxy/infrastructure/proxy-resolver'
import { ProxyTester } from './contexts/proxy/infrastructure/proxy-tester'
import { ProxyService } from './contexts/proxy/application/proxy-service'

// Account-group context — cross-platform account groupings + group→proxy binding.
import { MikroOrmAccountGroupRepository } from './contexts/accountGroup/infrastructure/mikro-orm-account-group-repository'
import { AccountGroupService } from './contexts/accountGroup/application/account-group-service'

/**
 * Account capability-registry adapter (quota manifest §5b).
 *
 * The account context's `ProviderCapabilityRegistry` is a NARROWER, account-id-
 * keyed shape than the quota context's `ProviderRegistry` (which is the
 * capability-trait registry keyed by credential/payload). This adapter bridges
 * the two: it implements the account interface on top of the credential
 * `ValidationService` (envelope-aware validation) and the quota
 * `QuotaApplicationService` (cache-first quota read), replacing the former
 * NULL_PROVIDER_REGISTRY placeholder.
 *
 * Note: `buildCredentialRegistry()` registers a real CredentialValidationCapability
 * for Kiro (decrypt + expiry/refresh check); other providers still return
 * `unsupported` until ported. So account health/validation flows through the real
 * wired services, with Kiro reporting valid/expired instead of unsupported. When
 * per-provider validation capabilities are added they light up automatically, and
 * health's quota leg (only reached when validation is `valid`) reads through the
 * quota service.
 */
function buildAccountCapabilityRegistry(
  credentialValidation: CredentialValidationService,
  quotaService: QuotaApplicationService,
): ProviderCapabilityRegistry {
  const validationCapability: ValidationCapability = {
    async validate(accountId: string): Promise<AccountValidationResult> {
      const result = await credentialValidation.validate(accountId)
      return validationResultToJson(result)
    },
  }
  const quotaCapability: QuotaCapability = {
    async fetchQuota(accountId: string): Promise<AccountQuotaFetchResult> {
      const info = await quotaService.getQuota(accountId)
      return {
        outcome: 'success',
        source: 'live',
        freshness: 'fresh',
        fetched_at: info.fetchedAt.toISOString(),
        models: info.models.map((m) => {
          const model: AccountQuotaFetchResult['models'][number] = {
            model_name: m.modelName,
            used: m.used,
            total: m.total,
          }
          if (m.resetAt !== undefined) model.reset_at = m.resetAt.toISOString()
          return model
        }),
      }
    },
  }
  return {
    validation(): ValidationCapability | undefined {
      return validationCapability
    },
    quota(): QuotaCapability | undefined {
      return quotaCapability
    },
  }
}

/** Holds lifecycle-managed singletons that main.ts needs beyond the IPC services. */
export interface Container extends Services {
  /** Token-refresh / health-scan scheduler (start on ready, stop on quit). */
  tokenRefreshScheduler: TokenRefreshScheduler
  /** Per-platform quota refresh scheduler (start on ready, stop on quit). */
  platformQuotaScheduler: PlatformQuotaScheduler
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
  const switchService = new SwitchService(credentialStore, injectorRegistry)
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
    settings.getAllowStaleKiroImport(),
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
  const usageAgentRegistry = new InMemoryAgentRegistry([
    new ClaudeAgentClient(),
    new CodexAgentClient(),
    new GeminiCliAgentClient(),
    new KiroAgentClient(),
    new QoderAgentClient(),
  ])
  const usageRecordRepo = new MikroOrmUsageRecordRepository()
  const usageRollupRepo = new MikroOrmUsageRollupRepository()
  const usageSyncStateRepo = new MikroOrmUsageSyncStateRepository()
  const usageSync = new UsageSyncService(usageAgentRegistry, usageRecordRepo)
  const usageQuery = new UsageQueryService(usageRollupRepo, usageSyncStateRepo)

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

  // 10. WebSocket push-server context. Bound to the configured ws_port (source
  //     default 9876). Not auto-started — the renderer toggles it via toggle_ws;
  //     status reports 'stopped' until then.
  const wsServer = new WsServer({ port: settings.getWsPort() })
  const websocket = new WebSocketApplicationService(wsServer)

  // 11. apiProxy 上下文。监听器绑定 settings 的 apiProxyPort（默认 8788），
  //     端口被占时 ApiHttpServer 自动回退 +1。不在此自启——main.ts 依据
  //     apiProxyEnabled 决定 whenReady 后是否 start()。
  //
  //     循环依赖（listener 需 service，service 又需 server）用方案 B（attachServer）打破，
  //     装配顺序固定：建 registry → 建 service（无 server）→ 建 listener（闭包引用 service）→
  //     建 ApiHttpServer(listener) → service.attachServer(server)。
  const platformRegistry = new PlatformRegistry()
  platformRegistry.register(new EchoUpstreamAdapter()) // 保留 Echo 占位（'echo'）。

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
  const kiroDispatcherPort: KiroDispatcherPort = {
    dispatcherForAccount(accountId: string) {
      return proxyResolver.dispatcherForAccount(accountId)
    },
  }
  const kiroTokenRefresher: KiroTokenRefresher = {
    async refresh(cred: KiroCredential, region: string): Promise<RefreshedKiroToken | undefined> {
      const refresh = cred.refreshToken
      if (refresh === undefined || refresh.trim().length === 0) return undefined
      const authMethod = resolveKiroAuthMethod(cred.rawMetadata)
      if (authMethod === 'api_key') return undefined // api_key 模式不刷新。
      // region：传入优先，否则按 profileArn 段兜底（与额度路径一致）。
      const meta = (cred.rawMetadata ?? {}) as Record<string, unknown>
      const profileArn =
        typeof meta.profileArn === 'string'
          ? meta.profileArn
          : typeof meta.profile_arn === 'string'
            ? (meta.profile_arn as string)
            : defaultProfileArnFor(authMethod)
      const useRegion = normalizeRegion(region || parseRegionFromArn(profileArn))
      try {
        if (authMethod === 'idc') {
          const clientId = typeof meta.client_id === 'string' ? meta.client_id : (meta.clientId as string | undefined)
          const clientSecret =
            typeof meta.client_secret === 'string' ? meta.client_secret : (meta.clientSecret as string | undefined)
          if (clientId === undefined || clientSecret === undefined) return undefined
          const out = await refreshKiroToken({ kind: 'idc', clientId, clientSecret, refreshToken: refresh, region: useRegion })
          return { token: out.accessToken, ...(out.refreshToken ? { refreshToken: out.refreshToken } : {}), ...(out.expiresAt ? { expiresAt: out.expiresAt } : {}) }
        }
        const out = await refreshKiroToken({ kind: 'social', refreshToken: refresh, region: useRegion })
        return { token: out.accessToken, ...(out.refreshToken ? { refreshToken: out.refreshToken } : {}), ...(out.expiresAt ? { expiresAt: out.expiresAt } : {}) }
      } catch {
        // 刷新失败（含 invalid_grant 永久失效）→ 放弃重试，由上游抛鉴权错误。
        return undefined
      }
    },
  }
  const kiroUpstreamClient = new KiroUpstreamClient({ refresher: kiroTokenRefresher })
  const kiroCacheTracker = new PromptCacheTracker()
  const apiProxyHealth = new AccountHealthTracker({
    baseCooldownMs: settings.getApiProxyBaseCooldownMs(),
    maxBackoffMultiplier: settings.getApiProxyMaxBackoffMultiplier(),
    quotaResetMs: settings.getApiProxyQuotaResetMs(),
    probabilisticRetryChance: settings.getApiProxyProbabilisticRetryChance(),
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
  const kiroConversationIdCache = new ConversationIdCache({ ttlMs: 2 * 60 * 60 * 1000, maxEntries: 1000 })
  const kiroInner = new KiroAdapter({
    client: kiroUpstreamClient,
    cacheTracker: kiroCacheTracker,
    conversationIdCache: kiroConversationIdCache,
    genConversationId: randomUUID,
  })
  platformRegistry.register(new FailoverAdapter({
    inner: kiroInner, selector: apiProxySelector, health: apiProxyHealth,
    accounts: kiroAccountPort, credentials: kiroCredentialPort, dispatchers: kiroDispatcherPort,
    maxRetries: settings.getApiProxyMaxRetries(),
    retryDelayMs: settings.getApiProxyRetryDelayMs(),
    random: Math.random,
  }))

  // M5 Key 加密存储：复用已有 cryptoService（不建第二个 master key）。
  const apiProxyKeyRepo = new ApiProxyKeyRepository(cryptoService)
  const apiProxyKeyService = new ApiProxyKeyService(apiProxyKeyRepo)

  // 启动迁移：将 settings 明文 Key 搬入加密表，然后清空 settings 字段（幂等，空则 no-op）。
  await migrateClientKeys(
    settings.getApiProxyClientKeys(),
    apiProxyKeyRepo,
    () => { void settings.updateSettings({ api_proxy_client_keys: '' }) },
  )

  // Responses 有状态持久化（previous_response_id 历史链 + store 落盘），默认目录在 appDataDir()/responses。
  const responsesStore = new ResponsesStore()
  const apiProxyService = new ApiProxyService(undefined, { registry: platformRegistry, responsesStore })
  // 客户端 Key 令牌桶限流器（后续可接 settings 动态配置 capacity/refillPerMinute）。
  const apiProxyKeyRateLimiter = new KeyRateLimiter({ capacity: 10, refillPerMinute: 10 })
  const apiHttpServer = new ApiHttpServer(
    createApiRequestListener({
      service: apiProxyService,
      auth: {
        keysProvider: () => apiProxyKeyRepo.listActivePlaintext(),
        allowAnonymousLoopback: settings.getApiProxyAllowAnonymousLoopback(),
      },
      knownPlatforms: platformRegistry.knownPlatforms(),
      keyRateLimiter: apiProxyKeyRateLimiter,
    }),
    { port: settings.getApiProxyPort() },
  )
  apiProxyService.attachServer(apiHttpServer)

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
    usageQuery,
    localBackup,
    mcp,
    sync,
    websocket,
    proxyService,
    accountGroupService,
    apiProxyService,
    apiProxyHealth,
    kiroAccountPort,
    apiProxyKeyService,
    tokenRefreshScheduler,
    platformQuotaScheduler,
  }
}
