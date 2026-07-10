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
  name?: string | undefined
  loginProvider?: string | undefined
  planName?: string | undefined
  planTier?: string | undefined
  status?: string | undefined
  statusReason?: string | undefined
  profilePayload: JsonValue
  tags: string[]
  notes?: string | undefined
  isActive: boolean
  /** Cursor 专属「额度用尽自动退款」开关（源自 profilePayload.autoRefundEnabled，默认 false）。 */
  autoRefundEnabled: boolean
  createdAt: string
  lastUsedAt?: string | undefined
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
    autoRefundEnabled: account.autoRefundEnabled,
    createdAt: account.createdAt.toISOString(),
    lastUsedAt: account.lastUsedAt ? account.lastUsedAt.toISOString() : undefined,
  }
}
