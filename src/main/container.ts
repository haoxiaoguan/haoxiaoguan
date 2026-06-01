import { join } from 'node:path'
import { homedir } from 'node:os'
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
import { ValidationService } from './contexts/account/application/validation-service'
import { AccountHealthService } from './contexts/account/application/health-service'
import { TokenRefreshScheduler } from './contexts/account/application/token-refresh-scheduler'
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
  const credentialRegistry = buildCredentialRegistry(cryptoService)
  const pendingOAuthRepo = new MikroOrmPendingOAuthRepository()
  const pendingImportRepo = new MikroOrmPendingImportRepository()
  void pendingImportRepo // reserved for the deep-link confirm flow (manifest §8)
  const credentialOAuth = new OAuthService(credentialRegistry, pendingOAuthRepo)
  const credentialImport = new ImportService(credentialRegistry)
  const credentialValidation = new CredentialValidationService(credentialStore, credentialRegistry)

  // 4c. Quota context — cache/state repos + live HTTP fetcher + application
  //     service. Depends on the account repo + credential store built above.
  const quotaCacheRepo = new MikroOrmQuotaCacheRepository()
  const quotaStateRepo = new MikroOrmQuotaStateRepository()
  const quotaFetcher = new HttpLiveQuotaFetcher()
  const quotaService = new QuotaApplicationService(
    accountRepo,
    credentialStore,
    quotaCacheRepo,
    quotaStateRepo,
    quotaFetcher,
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

  return {
    settings,
    agents,
    account,
    accountSwitchOrchestrator,
    accountValidation,
    accountHealth,
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
    tokenRefreshScheduler,
  }
}
