// PlatformId — quota module platform identity.
//
// Re-exports the agents-layer AgentId as PlatformId (17 variants, snake_case
// strings) and AgentFamily as IdeFamily, so quota code routes per-platform
// without redefining the enum (do NOT redefine — the shared agents layer owns it).

export type { AgentId as PlatformId } from '../../../agents/domain/agent-id'
export { ALL_AGENT_IDS as ALL_PLATFORM_IDS, parseAgentId, isAgentId } from '../../../agents/domain/agent-id'
export type { AgentFamily as IdeFamily } from '../../../agents/domain/agent-family'

import type { AgentId } from '../../../agents/domain/agent-id'
import { parseAgentId } from '../../../agents/domain/agent-id'

/**
 * Parse a platform string into its canonical snake_case PlatformId. The account
 * context's parsePlatform only accepts the 12 importable platforms; here we
 * accept any valid AgentId because the quota fetcher dispatches over all 17
 * (the 5 CLI-only agents resolve to Unsupported in the fetcher), matching the
 * AgentId routing in HttpLiveQuotaFetcher.
 */
export function parsePlatform(input: string): AgentId {
  return parseAgentId(input)
}
