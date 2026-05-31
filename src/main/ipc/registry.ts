import type { SettingsApplicationService } from '../contexts/settings/application/settings-service'
import { registerSettingsHandlers } from '../contexts/settings/ipc/settings-handlers'

import type { AgentRegistryService } from '../agents/application/agent-registry-service'
import { registerAgentHandlers } from '../agents/ipc/agent-handlers'

import type { AccountApplicationService } from '../contexts/account/application/account-service'
import type { SwitchOrchestrator } from '../contexts/account/application/switch-orchestrator'
import type { ValidationService } from '../contexts/account/application/validation-service'
import type { AccountHealthService } from '../contexts/account/application/health-service'
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

// The service singletons built by buildContainer(). Each implemented context
// contributes its application services; the IPC layer registers handlers that
// delegate to them.
//
// NOTE: the credential, quota, mcp, and sync contexts are NOT yet implemented
// (no IPC handlers / application services exist for them), so they are absent
// here. The renderer keeps the throwing tauriInvoke shim for those services
// until they land.
export interface Services {
  settings: SettingsApplicationService
  agents: AgentRegistryService

  // account context (+ health / switch-v2)
  account: AccountApplicationService
  accountSwitchOrchestrator: SwitchOrchestrator
  accountValidation: ValidationService
  accountHealth: AccountHealthService

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
}

// Each context contributes a register*Handlers function. As the remaining
// contexts (credential, quota, mcp, sync) land, add their registrations here.
export function registerAllHandlers(services: Services): void {
  registerSettingsHandlers(services.settings)
  registerAgentHandlers(services.agents)
  registerAccountHandlers({
    accountService: services.account,
    switchOrchestrator: services.accountSwitchOrchestrator,
    validationService: services.accountValidation,
    healthService: services.accountHealth,
  })
  registerSkillHandlers({
    skillService: services.skillService,
    discoveryService: services.discoveryService,
    backupService: services.backupService,
    storageService: services.storageService,
  })
  registerUsageHandlers(services.usageSync, services.usageQuery)
  registerLocalBackupHandlers(services.localBackup)
}
