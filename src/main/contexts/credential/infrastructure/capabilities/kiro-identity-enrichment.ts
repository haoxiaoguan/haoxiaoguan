import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { CredentialError } from '../../domain/credential-error'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import {
  type FetchImpl,
  type KiroAuthMethod,
  KiroAuthError,
  fetchKiroUsageLimits,
  normalizeRegion,
  parseRegionFromArn,
  refreshKiroToken,
  resolveKiroAuthMethod,
} from '../../../../platform/net/kiro/kiro-identity-client'

// Import-time identity enrichment for Kiro.
//
// WHY: an enterprise (IdC) account's true identity (email / userId / plan) is
// NOT in any local file — Kiro's local state.vscdb / profile.json can be a stale
// leftover from a previous account. The authoritative source is a live
// getUsageLimits call. We fetch it here, BEFORE the material leaves the main
// process, so the derived identityKey/displayIdentifier (computed in
// profileFromImportMaterial) are correct.
//
// CRITICAL: whether the live call succeeds or fails, we VOID the stale
// kiro_profile_raw (set it null). It poisons identity derivation (kiroProfile
// reads it before the live usage), so leaving it would import the wrong account.
// On failure we degrade to a placeholder identity — never the stale one.

interface RawMeta {
  [key: string]: JsonValue
}

export interface EnrichOptions {
  /** When false (default), a failed live identity fetch aborts the import. */
  allowStale?: boolean | undefined
  /** When true, skip the online identity check entirely and import with a
   *  placeholder identity. The stale local profile is still voided so a previous
   *  account's email/userId is never adopted. Takes precedence over allowStale. */
  skipOnline?: boolean | undefined
  /** Injectable transport for tests. */
  fetchImpl?: FetchImpl | undefined
}

/**
 * Enrich a Kiro import material with live identity. Mutates and returns a new
 * material; never returns the stale-identity version.
 */
export async function enrichKiroMaterial(
  material: ImportedCredentialMaterial,
  options: EnrichOptions = {},
): Promise<ImportedCredentialMaterial> {
  const allowStale = options.allowStale ?? false
  const meta: RawMeta = isObject(material.rawMetadata) ? { ...material.rawMetadata } : {}

  // skipOnline：完全不联网，直接以占位身份导入。仍 void 掉本地可能残留的旧身份，
  // 避免把上一个账号的 email/userId/plan 当成本账号（见文件头 CRITICAL 说明）。
  if (options.skipOnline === true) {
    voidLocalIdentity(meta)
    return { ...material, email: 'kiro-user', rawMetadata: meta as JsonValue }
  }

  const authMethod = resolveKiroAuthMethod(meta)
  const profileArn = asString(meta.profileArn) ?? asString(meta.profile_arn)
  const region = normalizeRegion(
    asString(meta.region) ?? parseRegionFromArn(profileArn) ?? undefined,
  )

  try {
    const live = await fetchLiveIdentity(material, meta, authMethod, region, profileArn, options.fetchImpl)
    return applyLiveIdentity(material, meta, live)
  } catch (err) {
    // Failure → never import the stale identity. Void EVERY local identity source
    // so derivation falls back to a neutral placeholder (kiro-<hash>) rather than
    // a previous account's email/userId/plan. A later quota refresh repopulates
    // kiro_usage_raw with live data and corrects the display.
    voidLocalIdentity(meta)
    meta.identity_enrichment_error = errorReason(err)

    if (!allowStale) {
      throw CredentialError.providerError(
        `无法联网确认 Kiro 账号身份（${errorReason(err)}）。`
          + '已阻止导入以免使用本地残留的旧账号信息。'
          + '请检查网络后重试，或在该平台设置里关闭「必须联网检查身份」以直接导入。',
        'kiro_identity_unconfirmed',
      )
    }
    // Placeholder email so the row is not labelled with the stale address.
    return { ...material, email: 'kiro-user', rawMetadata: meta as JsonValue }
  }
}

interface LiveIdentity {
  usage: JsonValue
  accessToken: string
  refreshToken?: string | undefined
  expiresAt?: Date | undefined
  profileArn?: string | undefined
}

async function fetchLiveIdentity(
  material: ImportedCredentialMaterial,
  meta: RawMeta,
  authMethod: KiroAuthMethod,
  region: string,
  profileArn: string | undefined,
  fetchImpl: FetchImpl | undefined,
): Promise<LiveIdentity> {
  let accessToken = material.accessToken
  let refreshToken = material.refreshToken
  let expiresAt = material.expiresAt
  let arn = profileArn

  // refreshToken-only paste (the reference's canonical IdC format carries no
  // accessToken): refresh up-front to obtain one before the first usage call,
  // rather than firing getUsageLimits with an empty bearer token.
  if (accessToken.trim().length === 0) {
    if (authMethod === 'api_key') {
      throw new Error('Kiro api_key import requires an access token')
    }
    const refreshed = await tryRefresh(meta, authMethod, region, refreshToken, fetchImpl)
    if (refreshed === undefined) {
      throw new Error('Kiro import: no access token and refresh failed (missing refreshToken/clientId/clientSecret?)')
    }
    accessToken = refreshed.accessToken
    refreshToken = refreshed.refreshToken ?? refreshToken
    expiresAt = refreshed.expiresAt ?? expiresAt
    arn = refreshed.profileArn ?? arn
    const usage = await fetchKiroUsageLimits(
      { accessToken, authMethod, region, profileArn: arn },
      { fetchImpl },
    )
    return { usage: usage as JsonValue, accessToken, refreshToken, expiresAt, profileArn: arn }
  }

  try {
    const usage = await fetchKiroUsageLimits(
      { accessToken, authMethod, region, profileArn: arn },
      { fetchImpl },
    )
    return { usage: usage as JsonValue, accessToken, refreshToken, expiresAt, profileArn: arn }
  } catch (firstErr) {
    // 401/expired → refresh once, then retry. invalid_grant is permanent.
    if (authMethod === 'api_key') throw firstErr
    const refreshed = await tryRefresh(meta, authMethod, region, refreshToken, fetchImpl)
    if (refreshed === undefined) throw firstErr
    accessToken = refreshed.accessToken
    refreshToken = refreshed.refreshToken ?? refreshToken
    expiresAt = refreshed.expiresAt ?? expiresAt
    arn = refreshed.profileArn ?? arn
    const usage = await fetchKiroUsageLimits(
      { accessToken, authMethod, region, profileArn: arn },
      { fetchImpl },
    )
    return { usage: usage as JsonValue, accessToken, refreshToken, expiresAt, profileArn: arn }
  }
}

async function tryRefresh(
  meta: RawMeta,
  authMethod: KiroAuthMethod,
  region: string,
  refreshToken: string | undefined,
  fetchImpl: FetchImpl | undefined,
) {
  if (refreshToken === undefined || refreshToken.trim().length === 0) return undefined
  if (authMethod === 'idc') {
    const clientId = asString(meta.client_id) ?? asString(meta.clientId)
    const clientSecret = asString(meta.client_secret) ?? asString(meta.clientSecret)
    if (clientId === undefined || clientSecret === undefined) return undefined
    return refreshKiroToken(
      { kind: 'idc', clientId, clientSecret, refreshToken, region },
      { fetchImpl },
    )
  }
  return refreshKiroToken({ kind: 'social', refreshToken, region }, { fetchImpl })
}

function applyLiveIdentity(
  material: ImportedCredentialMaterial,
  meta: RawMeta,
  live: LiveIdentity,
): ImportedCredentialMaterial {
  const userInfo = isObject(live.usage) && isObject(live.usage.userInfo) ? live.usage.userInfo : {}
  const email = asString(userInfo.email)
  const userId = asString(userInfo.userId) ?? asString(userInfo.user_id)
  const provider =
    asString(isObject(userInfo.provider) ? userInfo.provider.label : undefined) ??
    asString(isObject(userInfo.provider) ? userInfo.provider.name : undefined) ??
    asString(userInfo.loginProvider)

  meta.kiro_usage_raw = live.usage
  meta.kiro_profile_raw = null // void the stale local profile — live wins
  meta.identity_source = 'live'
  delete meta.identity_enrichment_error
  if (email !== undefined) meta.email = email
  if (userId !== undefined) meta.user_id = userId
  if (provider !== undefined) meta.login_provider = provider
  if (live.profileArn !== undefined) meta.profileArn = live.profileArn

  return {
    ...material,
    email: email ?? material.email,
    accessToken: live.accessToken,
    refreshToken: live.refreshToken,
    expiresAt: live.expiresAt,
    rawMetadata: meta as JsonValue,
  }
}

function errorReason(err: unknown): string {
  if (err instanceof KiroAuthError) return err.code
  if (err instanceof Error) return err.message
  return String(err)
}

/** Void every local identity source so derivation uses a neutral placeholder
 *  (kiro-<hash>) instead of a possibly-stale previous account's identity. Shared
 *  by the skip-online path and the live-failure path. */
function voidLocalIdentity(meta: RawMeta): void {
  meta.kiro_profile_raw = null
  meta.kiro_usage_raw = null
  meta.email = null
  meta.user_id = null
  meta.login_provider = null
  meta.identity_source = 'local_stale'
}

function isObject(value: unknown): value is RawMeta {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: JsonValue | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}
