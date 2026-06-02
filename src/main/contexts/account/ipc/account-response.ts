import type { Account } from '../domain/account'
import type { JsonValue } from '../domain/platform-account-profile'
import { platformFromAgentIdOrCursor, platformToFrontendId } from '../domain/platform-id'

// AccountResponse — the wire DTO returned to the renderer. EVERY field is
// camelCase on the wire (identityKey, displayIdentifier, profilePayload,
// loginProvider, planName, planTier, statusReason, isActive, createdAt,
// lastUsedAt). `platform` is the frontend kebab id. Optional fields are omitted
// (undefined) when absent. Timestamps are RFC3339.
export interface AccountResponse {
  id: string
  platform: string
  email: string
  identityKey: string
  displayIdentifier: string
  name?: string
  loginProvider?: string
  planName?: string
  planTier?: string
  status?: string
  statusReason?: string
  profilePayload: JsonValue
  tags: string[]
  notes?: string
  isActive: boolean
  createdAt: string
  lastUsedAt?: string
}

/** Map an Account aggregate to its camelCase wire DTO. */
export function toAccountResponse(account: Account): AccountResponse {
  return {
    id: account.id,
    platform: platformToFrontendId(platformFromAgentIdOrCursor(account.agentId)),
    email: account.email,
    identityKey: account.identityKey,
    displayIdentifier: account.displayIdentifier,
    name: account.name?.asStr(),
    loginProvider: account.loginProvider,
    planName: account.planName,
    planTier: account.planTier,
    status: account.status,
    statusReason: account.statusReason,
    profilePayload: account.profilePayload,
    tags: [...account.tags.asSlice()],
    notes: account.notes?.asStr(),
    isActive: account.isActive,
    createdAt: account.createdAt.toISOString(),
    lastUsedAt: account.lastUsedAt ? account.lastUsedAt.toISOString() : undefined,
  }
}
