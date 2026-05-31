// SessionLogReader capability interface — mirrors Rust
// agents::domain::session_log_reader::SessionLogReader (full trait).
//
// This is the canonical agents-domain port. The leaner
// agents/shared/session-log-reader.ts is a separate, minimal interface kept for
// the already-wired usage context; this one carries the full method set used by
// the registry/adapters.

import type { AgentError } from './agent-error'
import type { SessionMeta } from './session-meta'
import type { UsageCursor, UsageMetricsBatch } from './usage-metrics'

export interface SessionLogReader {
  /** Absolute root dir scanned for session logs. */
  logsRoot(): string
  /** List the concrete log files this adapter would read. Throws {@link AgentError}. */
  listSessionFiles(): Promise<string[]>
  /**
   * Read normalized usage metrics. Cursor is accepted but unused (full scan in
   * all current adapters). Throws {@link AgentError} on parse failure.
   */
  readUsageMetrics(cursor: UsageCursor | null): Promise<UsageMetricsBatch>
  /** Session metadata. Returns [] for all current adapters (TODO). */
  readSessionMeta(): Promise<SessionMeta[]>
}

export type { AgentError }
