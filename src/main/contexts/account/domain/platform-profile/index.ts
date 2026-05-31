import { PlatformAccountProfile, type JsonValue } from '../platform-account-profile'
import { type PlatformId } from '../platform-id'
import {
  type PayloadCell,
  commonStatus,
  commonStatusReason,
  decodeJwtClaims,
  emptyPayload,
  getPathValue,
  isObject,
  makeProfile,
  md5Hex,
  normalizeNonEmpty,
  normalizedIdentityKey,
  parseTimestamp,
  pickBool,
  pickNumber,
  pickString,
  providerFromLoginOption,
  sanitizeIdentifierPart,
  sanitizeProviderPayload,
  sanitizedPayload,
  shortHash,
  upsertGithubCopilotPayloadFields,
  upsertPayloadFromPath,
  upsertPayloadNumber,
  upsertPayloadString,
  upsertPayloadValue,
  upsertReferenceTimestamps,
} from './helpers'

// ---------------------------------------------------------------------------
// Per-platform profile derivation. Faithful 1:1 port of the source
// platform_profile/<platform>.rs modules. Each returns a PlatformAccountProfile
// with the identity, plan/status fields, and a sanitized profile payload.
// ---------------------------------------------------------------------------

function cell(value: JsonValue): PayloadCell {
  return { value }
}

// --- cursor ---
function cursorProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [
      ['auth_id'],
      ['authId'],
      ['cursor_auth_raw', 'auth_id'],
      ['cursor_auth_raw', 'authId'],
      ['cursor_auth_raw', 'user', 'id'],
      ['user', 'id'],
      ['auth', 'userId'],
      ['auth0Id'],
      ['id'],
      ['email'],
    ]) ??
    normalizeNonEmpty(email) ??
    `cursor-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['email'],
      ['cursor_auth_raw', 'email'],
      ['cursor_auth_raw', 'user', 'email'],
      ['user', 'email'],
      ['name'],
      ['user', 'name'],
      ['auth_id'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const loginProviderRaw = pickString(raw, [['sign_up_type'], ['signUpType'], ['loginProvider']])
  const loginProvider =
    loginProviderRaw === undefined
      ? undefined
      : providerFromLoginOption(loginProviderRaw) ?? loginProviderRaw
  const planName = pickString(raw, [
    ['plan'],
    ['planName'],
    ['membership_type'],
    ['membershipType'],
    ['subscription', 'name'],
  ])
  const planTier = pickString(raw, [
    ['membership_type'],
    ['membershipType'],
    ['plan_tier'],
    ['planTier'],
  ])
  const status = pickString(raw, [['status'], ['subscription_status'], ['subscriptionStatus']])
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadString(payload, 'authId', pickString(raw, [['auth_id'], ['authId']]))
  upsertPayloadString(payload, 'userId', identity)
  upsertPayloadString(payload, 'displayIdentifier', displayIdentifier)
  upsertPayloadString(payload, 'loginProvider', loginProvider)
  upsertPayloadString(payload, 'membershipType', planTier)
  upsertPayloadString(payload, 'subscriptionStatus', status)
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertPayloadFromPath(payload, 'cursorAuthRaw', raw, [['cursor_auth_raw']])
  upsertPayloadFromPath(payload, 'cursorUsageRaw', raw, [['cursor_usage_raw']])
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('cursor', identity, tokenHint),
    displayIdentifier,
    loginProvider,
    planName,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- windsurf ---
function windsurfProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [
      ['github_id'],
      ['githubId'],
      ['github_login'],
      ['githubLogin'],
      ['devin_account_id'],
      ['devinAccountId'],
      ['id'],
    ]) ??
    normalizeNonEmpty(email) ??
    `windsurf-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['github_login'],
      ['githubLogin'],
      ['github_email'],
      ['githubEmail'],
      ['github_name'],
      ['githubName'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const planName = pickString(raw, [
    ['copilot_plan'],
    ['copilotPlan'],
    ['windsurf_plan_status', 'plan'],
    ['windsurf_plan_status', 'planInfo', 'name'],
  ])
  const status = pickString(raw, [
    ['windsurf_user_status', 'status'],
    ['windsurf_plan_status', 'status'],
    ['status'],
  ])
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertGithubCopilotPayloadFields(payload, raw)
  upsertPayloadString(payload, 'loginProvider', 'GitHub')
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertPayloadFromPath(payload, 'windsurfApiServerUrl', raw, [
    ['windsurf_api_server_url'],
    ['windsurfApiServerUrl'],
  ])
  upsertPayloadFromPath(payload, 'windsurfUserStatus', raw, [
    ['windsurf_user_status'],
    ['windsurfUserStatus'],
  ])
  upsertPayloadFromPath(payload, 'windsurfPlanStatus', raw, [
    ['windsurf_plan_status'],
    ['windsurfPlanStatus'],
  ])
  upsertPayloadFromPath(payload, 'windsurfAuthStatusRaw', raw, [
    ['windsurf_auth_status_raw'],
    ['windsurfAuthStatusRaw'],
  ])
  upsertPayloadFromPath(payload, 'windsurfTokenType', raw, [
    ['windsurf_token_type'],
    ['windsurfTokenType'],
  ])
  upsertPayloadFromPath(payload, 'devinAccountId', raw, [['devin_account_id'], ['devinAccountId']])
  upsertPayloadFromPath(payload, 'devinOrgId', raw, [['devin_org_id'], ['devinOrgId']])
  upsertPayloadFromPath(payload, 'devinUserStatusProtoB64', raw, [
    ['devin_user_status_proto_b64'],
    ['devinUserStatusProtoB64'],
  ])
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('windsurf', identity, tokenHint),
    displayIdentifier,
    loginProvider: 'GitHub',
    planName,
    planTier: undefined,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- antigravity ---
function antigravityProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [
      ['auth_id'],
      ['authId'],
      ['antigravity_user_raw', 'id'],
      ['user', 'id'],
      ['user_id'],
      ['userId'],
      ['sub'],
      ['id'],
      ['email'],
    ]) ??
    normalizeNonEmpty(email) ??
    `antigravity-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['email'],
      ['antigravity_user_raw', 'email'],
      ['name'],
      ['antigravity_user_raw', 'name'],
      ['auth_id'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const loginProviderRaw = pickString(raw, [
    ['selected_auth_type'],
    ['selectedAuthType'],
    ['loginProvider'],
  ])
  const loginProvider =
    loginProviderRaw === undefined
      ? undefined
      : providerFromLoginOption(loginProviderRaw) ?? loginProviderRaw
  const planName = pickString(raw, [['plan_name'], ['planName'], ['plan', 'name'], ['tier_id']])
  const planTier = pickString(raw, [['tier_id'], ['tierId'], ['planTier']])
  const status = commonStatus(raw)
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadString(payload, 'authId', pickString(raw, [['auth_id'], ['authId']]))
  upsertPayloadString(payload, 'loginProvider', loginProvider)
  upsertPayloadString(payload, 'selectedAuthType', loginProvider)
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertPayloadFromPath(payload, 'antigravityOAuthRaw', raw, [['antigravity_oauth_raw']])
  upsertPayloadFromPath(payload, 'antigravityUserRaw', raw, [['antigravity_user_raw']])
  upsertPayloadFromPath(payload, 'antigravityUnifiedStateKey', raw, [
    ['antigravity_unified_state_key'],
  ])
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('antigravity', identity, tokenHint),
    displayIdentifier,
    loginProvider,
    planName,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- kiro ---
function kiroProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const authToken =
    raw === undefined
      ? undefined
      : getPathValue(raw, ['kiro_auth_token_raw']) ?? getPathValue(raw, ['authToken']) ?? raw
  const profile =
    raw === undefined
      ? undefined
      : getPathValue(raw, ['kiro_profile_raw']) ??
        getPathValue(raw, ['profile']) ??
        getPathValue(raw, ['userInfo'])
  const usage =
    raw === undefined
      ? undefined
      : getPathValue(raw, ['kiro_usage_raw']) ??
        getPathValue(raw, ['usage']) ??
        getPathValue(raw, ['quota']) ??
        raw
  const idTokenRaw = pickString(authToken, [['idToken'], ['id_token']])
  const idTokenClaims = idTokenRaw === undefined ? undefined : decodeJwtClaims(idTokenRaw)
  const accessTokenRaw = pickString(authToken, [['accessToken'], ['access_token'], ['token']])
  const accessTokenClaims = accessTokenRaw === undefined ? undefined : decodeJwtClaims(accessTokenRaw)

  const userId =
    pickString(profile, [['userId'], ['user_id'], ['id'], ['sub'], ['account', 'id']]) ??
    pickString(authToken, [
      ['userInfo', 'userId'],
      ['userId'],
      ['user_id'],
      ['sub'],
      ['accountId'],
      ['account', 'id'],
    ]) ??
    pickString(idTokenClaims, [['sub'], ['user_id'], ['uid'], ['preferred_username']]) ??
    pickString(accessTokenClaims, [['sub'], ['user_id'], ['uid'], ['preferred_username']])

  const displayIdentifier =
    userId ??
    normalizeNonEmpty(email) ??
    pickString(authToken, [['login_hint'], ['loginHint']]) ??
    `kiro-${shortHash(tokenHint)}`
  const identityKey = sanitizeIdentifierPart(displayIdentifier)
  const loginProviderRaw =
    pickString(profile, [['loginProvider'], ['provider'], ['authProvider'], ['signedInWith']]) ??
    pickString(authToken, [['login_option'], ['provider'], ['loginProvider']])
  const loginProvider =
    loginProviderRaw === undefined
      ? undefined
      : providerFromLoginOption(loginProviderRaw) ?? loginProviderRaw
  const planName =
    pickString(usage, [
      ['planName'],
      ['currentPlanName'],
      ['subscriptionInfo', 'subscriptionName'],
      ['subscriptionInfo', 'subscriptionTitle'],
      ['usageBreakdowns', 'planName'],
      ['freeTrialUsage', 'planName'],
      ['plan', 'name'],
    ]) ?? pickString(authToken, [['planName'], ['plan', 'name']])
  const planTier =
    pickString(usage, [
      ['planTier'],
      ['tier'],
      ['subscriptionInfo', 'type'],
      ['usageBreakdowns', 'tier'],
      ['plan', 'tier'],
    ]) ?? pickString(authToken, [['planTier'], ['plan', 'tier']])
  const status = pickString(raw, [['status'], ['accountStatus'], ['state'], ['userStatus']])
  const statusReason = pickString(raw, [['statusReason'], ['status_reason'], ['reason']])

  const payload = cell(raw === undefined ? emptyPayload() : sanitizeProviderPayload(structuredClone(raw)))
  upsertPayloadString(payload, 'userId', userId)
  upsertPayloadString(payload, 'loginProvider', loginProvider)
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertPayloadNumber(
    payload,
    'creditsTotal',
    pickNumber(usage, [
      ['creditsTotal'],
      ['estimatedUsage', 'total'],
      ['estimatedUsage', 'creditsTotal'],
      ['usageBreakdowns', 'plan', 'totalCredits'],
      ['usageBreakdowns', 'covered', 'total'],
      ['credits', 'total'],
      ['totalCredits'],
    ]),
  )
  upsertPayloadNumber(
    payload,
    'creditsUsed',
    pickNumber(usage, [
      ['creditsUsed'],
      ['estimatedUsage', 'used'],
      ['estimatedUsage', 'creditsUsed'],
      ['usageBreakdowns', 'plan', 'usedCredits'],
      ['usageBreakdowns', 'covered', 'used'],
      ['credits', 'used'],
      ['usedCredits'],
    ]),
  )
  upsertPayloadNumber(
    payload,
    'bonusTotal',
    pickNumber(usage, [
      ['bonusTotal'],
      ['bonusCredits', 'total'],
      ['bonus', 'total'],
      ['usageBreakdowns', 'bonus', 'total'],
    ]),
  )
  upsertPayloadNumber(
    payload,
    'bonusUsed',
    pickNumber(usage, [
      ['bonusUsed'],
      ['bonusCredits', 'used'],
      ['bonus', 'used'],
      ['usageBreakdowns', 'bonus', 'used'],
    ]),
  )
  const usageResetAt = parseTimestamp(
    (usage === undefined ? undefined : getPathValue(usage, ['usageResetAt'])) ??
      (usage === undefined ? undefined : getPathValue(usage, ['resetAt'])) ??
      (usage === undefined ? undefined : getPathValue(usage, ['resetTime'])),
  )
  upsertPayloadValue(payload, 'usageResetAt', usageResetAt === undefined ? undefined : usageResetAt)
  const bonusExpireDays = pickNumber(usage, [
    ['bonusExpireDays'],
    ['bonusCredits', 'expiryDays'],
    ['bonusCredits', 'expireDays'],
    ['bonus', 'expiryDays'],
  ])
  upsertPayloadValue(
    payload,
    'bonusExpireDays',
    bonusExpireDays === undefined ? undefined : Math.round(bonusExpireDays),
  )
  return makeProfile({
    identityKey,
    displayIdentifier,
    loginProvider,
    planName,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- github_copilot ---
function githubCopilotProfile(
  email: string,
  raw: JsonValue | undefined,
  tokenHint: string,
): PlatformAccountProfile {
  const identity =
    pickString(raw, [
      ['github_id'],
      ['githubId'],
      ['user', 'id'],
      ['id'],
      ['github_login'],
      ['githubLogin'],
      ['user', 'login'],
      ['login'],
    ]) ??
    normalizeNonEmpty(email) ??
    `github-copilot-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['github_login'],
      ['githubLogin'],
      ['user', 'login'],
      ['login'],
      ['github_email'],
      ['githubEmail'],
      ['user', 'email'],
      ['email'],
      ['github_name'],
      ['githubName'],
      ['user', 'name'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const planName = pickString(raw, [
    ['copilot_plan'],
    ['copilotPlan'],
    ['plan', 'name'],
    ['subscription', 'name'],
    ['entitlement', 'name'],
  ])
  const status = commonStatus(raw)
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertGithubCopilotPayloadFields(payload, raw)
  upsertPayloadString(payload, 'loginProvider', 'GitHub')
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('github_copilot', identity, tokenHint),
    displayIdentifier,
    loginProvider: 'GitHub',
    planName,
    planTier: undefined,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- gemini (gemini_cli) ---
function geminiProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [
      ['auth_id'],
      ['authId'],
      ['account', 'id'],
      ['user', 'id'],
      ['user_id'],
      ['userId'],
      ['sub'],
      ['id'],
      ['email'],
    ]) ??
    normalizeNonEmpty(email) ??
    `gemini-cli-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['email'],
      ['account', 'email'],
      ['user', 'email'],
      ['name'],
      ['user', 'name'],
      ['auth_id'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const loginProviderRaw = pickString(raw, [
    ['selected_auth_type'],
    ['selectedAuthType'],
    ['loginProvider'],
  ])
  const loginProvider =
    loginProviderRaw === undefined
      ? undefined
      : providerFromLoginOption(loginProviderRaw) ?? loginProviderRaw
  const planName = pickString(raw, [['plan_name'], ['planName'], ['plan', 'name'], ['tier_id']])
  const planTier = pickString(raw, [['tier_id'], ['tierId'], ['planTier']])
  const status = commonStatus(raw)
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadString(payload, 'authId', pickString(raw, [['auth_id'], ['authId']]))
  upsertPayloadString(payload, 'loginProvider', loginProvider)
  upsertPayloadString(payload, 'selectedAuthType', loginProvider)
  upsertPayloadFromPath(payload, 'projectId', raw, [['project_id'], ['projectId']])
  upsertPayloadFromPath(payload, 'tierId', raw, [['tier_id'], ['tierId']])
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  upsertPayloadFromPath(payload, 'geminiAuthRaw', raw, [['gemini_auth_raw']])
  upsertPayloadFromPath(payload, 'geminiUsageRaw', raw, [['gemini_usage_raw']])
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('gemini_cli', identity, tokenHint),
    displayIdentifier,
    loginProvider,
    planName,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- codex ---
function buildCodexStorageId(
  email: string,
  accountId: string | undefined,
  organizationId: string | undefined,
): string {
  let seed = email.trim()
  const id = accountId === undefined ? undefined : normalizeNonEmpty(accountId)
  if (id !== undefined) {
    seed += `|${id}`
  }
  const org = organizationId === undefined ? undefined : normalizeNonEmpty(organizationId)
  if (org !== undefined) {
    seed += `|${org}`
  }
  return `codex_${md5Hex(seed)}`
}

function buildCodexApiKeyId(apiKey: string): string {
  return `codex_apikey_${md5Hex(apiKey)}`
}

function codexProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const referenceEmail =
    pickString(raw, [['email']]) ?? normalizeNonEmpty(email) ?? `codex-${shortHash(tokenHint)}`
  const accountId = pickString(raw, [['account_id'], ['accountId'], ['tokens', 'account_id']])
  const organizationId = pickString(raw, [['organization_id'], ['organizationId']])
  const codexStorageId = buildCodexStorageId(referenceEmail, accountId, organizationId)
  const apiKey = pickString(raw, [['api_key'], ['apiKey']])
  const apiKeyIdentity = apiKey === undefined ? undefined : buildCodexApiKeyId(apiKey)
  const identity =
    pickString(raw, [['codex_storage_id'], ['codexStorageId']]) ?? apiKeyIdentity ?? codexStorageId
  const displayIdentifier =
    pickString(raw, [
      ['email'],
      ['account_name'],
      ['accountName'],
      ['user_id'],
      ['userId'],
      ['account_id'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const loginProvider = pickString(raw, [['auth_mode'], ['authMode']])
  const planName = pickString(raw, [
    ['plan_type'],
    ['planType'],
    ['auth_file_plan_type'],
    ['authFilePlanType'],
    ['plan'],
  ])
  const status =
    pickBool(raw, [['requires_reauth'], ['requiresReauth']]) === true
      ? 'requires_reauth'
      : commonStatus(raw)
  const statusReason =
    pickString(raw, [['reauth_reason'], ['reauthReason']]) ?? commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadFromPath(payload, 'authMode', raw, [['auth_mode'], ['authMode']])
  upsertPayloadFromPath(payload, 'apiBaseUrl', raw, [['api_base_url'], ['apiBaseUrl']])
  upsertPayloadFromPath(payload, 'apiProviderMode', raw, [['api_provider_mode'], ['apiProviderMode']])
  upsertPayloadFromPath(payload, 'apiProviderId', raw, [['api_provider_id'], ['apiProviderId']])
  upsertPayloadFromPath(payload, 'apiProviderName', raw, [['api_provider_name'], ['apiProviderName']])
  upsertPayloadFromPath(payload, 'boundOauthAccountId', raw, [
    ['bound_oauth_account_id'],
    ['boundOauthAccountId'],
  ])
  upsertPayloadFromPath(payload, 'userId', raw, [['user_id'], ['userId']])
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planName)
  upsertPayloadFromPath(payload, 'planType', raw, [['plan_type'], ['planType']])
  upsertPayloadFromPath(payload, 'subscriptionActiveUntil', raw, [
    ['subscription_active_until'],
    ['subscriptionActiveUntil'],
  ])
  upsertPayloadFromPath(payload, 'authFilePlanType', raw, [
    ['auth_file_plan_type'],
    ['authFilePlanType'],
  ])
  upsertPayloadFromPath(payload, 'accountId', raw, [['account_id'], ['accountId']])
  upsertPayloadFromPath(payload, 'organizationId', raw, [['organization_id'], ['organizationId']])
  upsertPayloadString(payload, 'codexStorageId', codexStorageId)
  upsertPayloadFromPath(payload, 'accountName', raw, [['account_name'], ['accountName']])
  upsertPayloadFromPath(payload, 'accountStructure', raw, [
    ['account_structure'],
    ['accountStructure'],
  ])
  upsertPayloadFromPath(payload, 'accountNote', raw, [['account_note'], ['accountNote']])
  upsertPayloadFromPath(payload, 'appSpeed', raw, [['app_speed'], ['appSpeed']])
  upsertPayloadFromPath(payload, 'tokenGeneration', raw, [['token_generation'], ['tokenGeneration']])
  upsertPayloadFromPath(payload, 'tokenUpdatedAt', raw, [['token_updated_at'], ['tokenUpdatedAt']])
  upsertPayloadFromPath(payload, 'tokenSourceMode', raw, [['token_source_mode'], ['tokenSourceMode']])
  upsertPayloadFromPath(payload, 'requiresReauth', raw, [['requires_reauth'], ['requiresReauth']])
  upsertPayloadFromPath(payload, 'reauthReason', raw, [['reauth_reason'], ['reauthReason']])
  upsertPayloadFromPath(payload, 'quotaError', raw, [['quota_error'], ['quotaError']])
  upsertReferenceTimestamps(payload, raw)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  return makeProfile({
    identityKey: normalizedIdentityKey('codex', identity, tokenHint),
    displayIdentifier,
    loginProvider,
    planName,
    planTier: planName,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- codebuddy / codebuddy_cn ---
function codebuddyProfile(
  platform: PlatformId,
  email: string,
  raw: JsonValue | undefined,
  tokenHint: string,
): PlatformAccountProfile {
  const identity =
    pickString(raw, [['uid'], ['id'], ['email']]) ??
    normalizeNonEmpty(email) ??
    normalizedIdentityKey(platform, '', tokenHint)
  const displayIdentifier =
    pickString(raw, [['email'], ['nickname'], ['uid'], ['id']]) ??
    normalizeNonEmpty(email) ??
    identity
  const planTier = pickString(raw, [['plan_type'], ['planType']])
  const status = commonStatus(raw)
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadFromPath(payload, 'uid', raw, [['uid']])
  upsertPayloadFromPath(payload, 'nickname', raw, [['nickname']])
  upsertPayloadFromPath(payload, 'enterpriseId', raw, [['enterprise_id'], ['enterpriseId']])
  upsertPayloadFromPath(payload, 'enterpriseName', raw, [['enterprise_name'], ['enterpriseName']])
  upsertPayloadFromPath(payload, 'domain', raw, [['domain']])
  upsertPayloadFromPath(payload, 'planType', raw, [['plan_type'], ['planType']])
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadFromPath(payload, 'dosageNotifyCode', raw, [
    ['dosage_notify_code'],
    ['dosageNotifyCode'],
  ])
  upsertPayloadFromPath(payload, 'dosageNotifyZh', raw, [['dosage_notify_zh'], ['dosageNotifyZh']])
  upsertPayloadFromPath(payload, 'dosageNotifyEn', raw, [['dosage_notify_en'], ['dosageNotifyEn']])
  upsertPayloadFromPath(payload, 'paymentType', raw, [['payment_type'], ['paymentType']])
  upsertPayloadFromPath(payload, 'authRaw', raw, [['auth_raw'], ['authRaw']])
  upsertPayloadFromPath(payload, 'profileRaw', raw, [['profile_raw'], ['profileRaw']])
  upsertPayloadFromPath(payload, 'quotaRaw', raw, [['quota_raw'], ['quotaRaw']])
  upsertPayloadFromPath(payload, 'usageRaw', raw, [['usage_raw'], ['usageRaw']])
  upsertPayloadFromPath(payload, 'lastCheckinTime', raw, [['last_checkin_time'], ['lastCheckinTime']])
  upsertPayloadFromPath(payload, 'checkinStreak', raw, [['checkin_streak'], ['checkinStreak']])
  upsertPayloadFromPath(payload, 'checkinRewards', raw, [['checkin_rewards'], ['checkinRewards']])
  upsertReferenceTimestamps(payload, raw)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  return makeProfile({
    identityKey: normalizedIdentityKey(platform, identity, tokenHint),
    displayIdentifier,
    loginProvider: undefined,
    planName: planTier,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- qoder ---
function qoderProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [['user_id'], ['userId'], ['id'], ['email']]) ??
    normalizeNonEmpty(email) ??
    `qoder-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [['email'], ['display_name'], ['displayName'], ['user_id']]) ??
    normalizeNonEmpty(email) ??
    identity
  const planTier = pickString(raw, [['plan_type'], ['planType']])
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadFromPath(payload, 'userId', raw, [['user_id'], ['userId']])
  upsertPayloadFromPath(payload, 'displayName', raw, [['display_name'], ['displayName']])
  upsertPayloadFromPath(payload, 'planType', raw, [['plan_type'], ['planType']])
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadFromPath(payload, 'creditsUsed', raw, [['credits_used'], ['creditsUsed']])
  upsertPayloadFromPath(payload, 'creditsTotal', raw, [['credits_total'], ['creditsTotal']])
  upsertPayloadFromPath(payload, 'creditsRemaining', raw, [
    ['credits_remaining'],
    ['creditsRemaining'],
  ])
  upsertPayloadFromPath(payload, 'creditsUsagePercent', raw, [
    ['credits_usage_percent'],
    ['creditsUsagePercent'],
  ])
  upsertPayloadFromPath(payload, 'authUserInfoRaw', raw, [['auth_user_info_raw'], ['authUserInfoRaw']])
  upsertPayloadFromPath(payload, 'authUserPlanRaw', raw, [['auth_user_plan_raw'], ['authUserPlanRaw']])
  upsertPayloadFromPath(payload, 'authCreditUsageRaw', raw, [
    ['auth_credit_usage_raw'],
    ['authCreditUsageRaw'],
  ])
  upsertReferenceTimestamps(payload, raw)
  return makeProfile({
    identityKey: normalizedIdentityKey('qoder', identity, tokenHint),
    displayIdentifier,
    loginProvider: undefined,
    planName: planTier,
    planTier,
    status: undefined,
    statusReason: commonStatusReason(raw),
    profilePayload: payload.value,
  })
}

// --- trae ---
function traeProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [['user_id'], ['userId'], ['id'], ['email']]) ??
    normalizeNonEmpty(email) ??
    `trae-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [['email'], ['nickname'], ['user_id']]) ??
    normalizeNonEmpty(email) ??
    identity
  const planTier = pickString(raw, [['plan_type'], ['planType']])
  const status = commonStatus(raw)
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadFromPath(payload, 'userId', raw, [['user_id'], ['userId']])
  upsertPayloadFromPath(payload, 'nickname', raw, [['nickname']])
  upsertPayloadFromPath(payload, 'planType', raw, [['plan_type'], ['planType']])
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadFromPath(payload, 'planResetAt', raw, [['plan_reset_at'], ['planResetAt']])
  upsertPayloadFromPath(payload, 'traeAuthRaw', raw, [['trae_auth_raw'], ['traeAuthRaw']])
  upsertPayloadFromPath(payload, 'traeProfileRaw', raw, [['trae_profile_raw'], ['traeProfileRaw']])
  upsertPayloadFromPath(payload, 'traeEntitlementRaw', raw, [
    ['trae_entitlement_raw'],
    ['traeEntitlementRaw'],
  ])
  upsertPayloadFromPath(payload, 'traeUsageRaw', raw, [['trae_usage_raw'], ['traeUsageRaw']])
  upsertPayloadFromPath(payload, 'traeServerRaw', raw, [['trae_server_raw'], ['traeServerRaw']])
  upsertPayloadFromPath(payload, 'traeUsertagRaw', raw, [['trae_usertag_raw'], ['traeUsertagRaw']])
  upsertReferenceTimestamps(payload, raw)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  return makeProfile({
    identityKey: normalizedIdentityKey('trae', identity, tokenHint),
    displayIdentifier,
    loginProvider: undefined,
    planName: planTier,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

// --- zed ---
function zedProfile(email: string, raw: JsonValue | undefined, tokenHint: string): PlatformAccountProfile {
  const identity =
    pickString(raw, [['user_id'], ['userId'], ['id'], ['github_login'], ['githubLogin']]) ??
    pickString(raw, [['user', 'id']]) ??
    normalizeNonEmpty(email) ??
    `zed-${shortHash(tokenHint)}`
  const displayIdentifier =
    pickString(raw, [
      ['github_login'],
      ['githubLogin'],
      ['display_name'],
      ['displayName'],
      ['user', 'username'],
      ['user', 'name'],
      ['user_id'],
    ]) ??
    normalizeNonEmpty(email) ??
    identity
  const planName = pickString(raw, [
    ['plan_raw'],
    ['planRaw'],
    ['subscription', 'tier'],
    ['plan', 'name'],
  ])
  const planTier = pickString(raw, [['subscription', 'tier'], ['plan', 'tier'], ['planTier']])
  const status = pickString(raw, [['subscription_status'], ['subscriptionStatus'], ['status']])
  const statusReason = commonStatusReason(raw)
  const payload = cell(sanitizedPayload(raw))
  upsertPayloadFromPath(payload, 'userId', raw, [['user_id'], ['userId']])
  upsertPayloadFromPath(payload, 'githubLogin', raw, [['github_login'], ['githubLogin']])
  upsertPayloadFromPath(payload, 'displayName', raw, [['display_name'], ['displayName']])
  upsertPayloadFromPath(payload, 'avatarUrl', raw, [['avatar_url'], ['avatarUrl']])
  upsertPayloadFromPath(payload, 'planRaw', raw, [['plan_raw'], ['planRaw']])
  upsertPayloadString(payload, 'planName', planName)
  upsertPayloadString(payload, 'planTier', planTier)
  upsertPayloadFromPath(payload, 'subscriptionStatus', raw, [
    ['subscription_status'],
    ['subscriptionStatus'],
  ])
  upsertPayloadFromPath(payload, 'hasOverdueInvoices', raw, [
    ['has_overdue_invoices'],
    ['hasOverdueInvoices'],
  ])
  upsertPayloadFromPath(payload, 'billingPeriodStartAt', raw, [
    ['billing_period_start_at'],
    ['billingPeriodStartAt'],
  ])
  upsertPayloadFromPath(payload, 'billingPeriodEndAt', raw, [
    ['billing_period_end_at'],
    ['billingPeriodEndAt'],
  ])
  upsertPayloadFromPath(payload, 'trialStartedAt', raw, [['trial_started_at'], ['trialStartedAt']])
  upsertPayloadFromPath(payload, 'trialEndAt', raw, [['trial_end_at'], ['trialEndAt']])
  upsertPayloadFromPath(payload, 'tokenSpendUsedCents', raw, [
    ['token_spend_used_cents'],
    ['tokenSpendUsedCents'],
  ])
  upsertPayloadFromPath(payload, 'tokenSpendLimitCents', raw, [
    ['token_spend_limit_cents'],
    ['tokenSpendLimitCents'],
  ])
  upsertPayloadFromPath(payload, 'tokenSpendRemainingCents', raw, [
    ['token_spend_remaining_cents'],
    ['tokenSpendRemainingCents'],
  ])
  upsertPayloadFromPath(payload, 'editPredictionsUsed', raw, [
    ['edit_predictions_used'],
    ['editPredictionsUsed'],
  ])
  upsertPayloadFromPath(payload, 'editPredictionsLimitRaw', raw, [
    ['edit_predictions_limit_raw'],
    ['editPredictionsLimitRaw'],
  ])
  upsertPayloadFromPath(payload, 'editPredictionsRemainingRaw', raw, [
    ['edit_predictions_remaining_raw'],
    ['editPredictionsRemainingRaw'],
  ])
  upsertPayloadFromPath(payload, 'spendingLimitCents', raw, [
    ['spending_limit_cents'],
    ['spendingLimitCents'],
  ])
  upsertPayloadFromPath(payload, 'billingPortalUrl', raw, [['billing_portal_url'], ['billingPortalUrl']])
  upsertPayloadFromPath(payload, 'userRaw', raw, [['user_raw'], ['userRaw']])
  upsertPayloadFromPath(payload, 'subscriptionRaw', raw, [['subscription_raw'], ['subscriptionRaw']])
  upsertPayloadFromPath(payload, 'usageRaw', raw, [['usage_raw'], ['usageRaw']])
  upsertPayloadFromPath(payload, 'usageTokensRaw', raw, [['usage_tokens_raw'], ['usageTokensRaw']])
  upsertPayloadFromPath(payload, 'preferencesRaw', raw, [['preferences_raw'], ['preferencesRaw']])
  upsertReferenceTimestamps(payload, raw)
  upsertPayloadString(payload, 'status', status)
  upsertPayloadString(payload, 'statusReason', statusReason)
  return makeProfile({
    identityKey: normalizedIdentityKey('zed', identity, tokenHint),
    displayIdentifier,
    loginProvider: 'GitHub',
    planName,
    planTier,
    status,
    statusReason,
    profilePayload: payload.value,
  })
}

/**
 * Dispatch to the platform-specific profile derivation, mirroring source
 * platform_profile::profile_from_import_material. Non-importable platforms fall
 * back to a bare identity profile (source `_ => from_identifier(email)`).
 */
export function profileFromImportMaterial(
  platform: PlatformId,
  email: string,
  rawMetadata: JsonValue | undefined,
  tokenHint: string,
): PlatformAccountProfile {
  switch (platform) {
    case 'cursor':
      return cursorProfile(email, rawMetadata, tokenHint)
    case 'windsurf':
      return windsurfProfile(email, rawMetadata, tokenHint)
    case 'antigravity':
      return antigravityProfile(email, rawMetadata, tokenHint)
    case 'kiro':
      return kiroProfile(email, rawMetadata, tokenHint)
    case 'github_copilot':
      return githubCopilotProfile(email, rawMetadata, tokenHint)
    case 'gemini_cli':
      return geminiProfile(email, rawMetadata, tokenHint)
    case 'codex':
      return codexProfile(email, rawMetadata, tokenHint)
    case 'codebuddy':
    case 'codebuddy_cn':
      return codebuddyProfile(platform, email, rawMetadata, tokenHint)
    case 'qoder':
      return qoderProfile(email, rawMetadata, tokenHint)
    case 'trae':
      return traeProfile(email, rawMetadata, tokenHint)
    case 'zed':
      return zedProfile(email, rawMetadata, tokenHint)
    default:
      return PlatformAccountProfile.fromIdentifier(email)
  }
}
