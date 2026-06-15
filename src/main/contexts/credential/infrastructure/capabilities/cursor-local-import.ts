import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { normalizeNonEmpty, readVscdbItem } from '../vscdb-reader'
import { stateVscdbPath } from '../scan-helpers'

// Cursor local-scan capability. Reads cursorAuth/* keys from Cursor's
// state.vscdb. Requires accessToken + cachedEmail; returns [] otherwise.

const CURSOR_APP_DIR = 'Cursor'

export class CursorLocalImportCapability implements LocalImportCapability {
  constructor(private readonly stateDbPathOverride?: string) {}

  provider(): PlatformId {
    return 'cursor'
  }

  private resolveStateDbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath(CURSOR_APP_DIR)
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.resolveStateDbPath()
    const accessToken = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/accessToken'))
    if (!accessToken) return []
    const email = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/cachedEmail'))
    if (!email) return []

    const refreshToken = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/refreshToken'))
    const authId =
      normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/authId')) ??
      extractAuthIdFromAccessToken(accessToken)
    const membershipType = normalizeNonEmpty(
      readVscdbItem(dbPath, 'cursorAuth/stripeMembershipType'),
    )
    const subscriptionStatus = normalizeNonEmpty(
      readVscdbItem(dbPath, 'cursorAuth/stripeSubscriptionStatus'),
    )
    const signUpType = normalizeNonEmpty(readVscdbItem(dbPath, 'cursorAuth/cachedSignUpType'))

    return [
      {
        provider: 'cursor',
        email,
        accessToken,
        refreshToken,
        expiresAt: undefined,
        source: 'local_scan',
        rawMetadata: buildCursorRawMetadata({
          email,
          accessToken,
          refreshToken,
          authId,
          membershipType,
          subscriptionStatus,
          signUpType,
        }),
      },
    ]
  }
}

function extractAuthIdFromAccessToken(accessToken: string): string | undefined {
  const seg = accessToken.split('.')[1]
  if (!seg) return undefined
  try {
    const decoded = Buffer.from(seg, 'base64url').toString('utf8')
    const value = JSON.parse(decoded) as Record<string, unknown>
    const sub = value.sub
    return typeof sub === 'string' ? normalizeNonEmpty(sub) : undefined
  } catch {
    return undefined
  }
}

interface CursorMetaInput {
  email: string
  accessToken: string
  refreshToken?: string | undefined
  authId?: string | undefined
  membershipType?: string | undefined
  subscriptionStatus?: string | undefined
  signUpType?: string | undefined
}

function buildCursorRawMetadata(input: CursorMetaInput): JsonValue {
  const authRaw: Record<string, JsonValue> = {
    accessToken: input.accessToken,
    cachedEmail: input.email,
  }
  if (input.refreshToken) authRaw.refreshToken = input.refreshToken
  if (input.authId) authRaw.authId = input.authId
  if (input.membershipType) authRaw.stripeMembershipType = input.membershipType
  if (input.subscriptionStatus) authRaw.stripeSubscriptionStatus = input.subscriptionStatus
  if (input.signUpType) authRaw.cachedSignUpType = input.signUpType

  return {
    email: input.email,
    auth_id: input.authId ?? null,
    membership_type: input.membershipType ?? null,
    subscription_status: input.subscriptionStatus ?? null,
    sign_up_type: input.signUpType ?? null,
    cursor_auth_raw: authRaw,
  }
}
