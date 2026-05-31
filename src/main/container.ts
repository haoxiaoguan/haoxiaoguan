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
import { MikroOrmCredentialStore } from './contexts/account/infrastructure/mikro-orm-credential-store'
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
} from './contexts/account/application/capability-ports'
import { AgentCredentialInjectorRegistry } from './agents/credential-injection/injector-registry'
import { loadOrCreateMasterKey, CryptoService } from './platform/crypto/crypto-service'

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

/**
 * No-capability provider registry. The quota / credential capability layer is
 * not yet implemented (those contexts have no source here), so every platform
 * lookup returns undefined. ValidationService / AccountHealthService handle that
 * gracefully ("unsupported provider" / unknown_error), matching the account
 * manifest §5/§9 contract. Replace with the real registry when quota lands.
 */
const NULL_PROVIDER_REGISTRY: ProviderCapabilityRegistry = {
  validation(): ValidationCapability | undefined {
    return undefined
  },
  quota(): QuotaCapability | undefined {
    return undefined
  },
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

  // 4. Account context.
  const accountRepo = new MikroOrmAccountRepository()
  const masterKey = await loadOrCreateMasterKey()
  const credentialStore = new MikroOrmCredentialStore(new CryptoService(masterKey))
  const injectorRegistry = new AgentCredentialInjectorRegistry()
  const switchService = new SwitchService(credentialStore, injectorRegistry)
  const account = new AccountApplicationService(accountRepo, credentialStore, switchService)
  const accountSwitchOrchestrator = new SwitchOrchestrator(
    accountRepo,
    credentialStore,
    injectorRegistry,
  )
  const platformLookup = new RepositoryAccountPlatformLookup(accountRepo)
  const accountValidation = new ValidationService(NULL_PROVIDER_REGISTRY, platformLookup)
  const accountHealth = new AccountHealthService(
    accountValidation,
    NULL_PROVIDER_REGISTRY,
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

  return {
    settings,
    agents,
    account,
    accountSwitchOrchestrator,
    accountValidation,
    accountHealth,
    skillService,
    discoveryService,
    backupService,
    storageService,
    usageSync,
    usageQuery,
    localBackup,
    tokenRefreshScheduler,
  }
}
