import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'

/** Mirrors Rust SessionLogReader trait — implemented by each agent adapter. */
export interface SessionLogReader {
  readUsageMetrics(cursor: UsageCursor | null): Promise<UsageMetricsBatch>
}

/** Capability flags — mirrors Rust Capability enum. */
export type Capability = 'credential' | 'skills' | 'mcp' | 'session_log'

/** Minimal agent client interface needed by UsageSyncService. */
export interface AgentClient {
  id(): string
  capabilities(): Capability[]
  asSessionLogReader(): SessionLogReader | null
}

/** Registry interface — mirrors Rust AgentRegistryTrait. */
export interface AgentRegistry {
  listByCapability(cap: Capability): AgentClient[]
}
