// SessionMeta — mirrors Rust agents::domain::session_meta::SessionMeta.
// Not yet populated by any adapter (read_session_meta returns [] everywhere);
// defined here for the future session-manager phase and contract completeness.

import type { AgentId } from './agent-id'

export interface SessionMeta {
  agentId: AgentId
  sessionId: string
  title?: string
  summary?: string
  projectDir?: string
  sourcePath: string
  /** Unix seconds. */
  lastUpdatedAt: number
}
