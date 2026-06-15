// Quota-state dispatch — fromAccountProfile + fromFetchResultForPlatform.
//
// Re-exports the model + types so consumers import the quota-state module from
// one place.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../platform-id'
import type { QuotaFetchResult } from '../capabilities'
import { AccountQuotaState, sanitizeProviderPayload } from './model'

import { stateFromProfile as kiroState } from './kiro'
import { stateFromProfile as cursorState } from './cursor'
import { stateFromProfile as geminiState } from './gemini'
import { stateFromProfile as codexState } from './codex'
import { stateFromProfile as copilotState } from './copilot'
import { stateFromProfile as codebuddyState } from './codebuddy'
import { stateFromProfile as qoderState } from './qoder'
import { stateFromProfile as traeState } from './trae'
import { stateFromProfile as zedState } from './zed'

export * from './model'
export * from './serde'

function isEmptyObject(value: JsonValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

function isJsonNull(value: JsonValue): boolean {
  return value === null || value === undefined
}

/**
 * Dispatch profile-payload parsing per platform.
 * Antigravity + the 5 CLI-only agents return undefined.
 */
export function fromAccountProfile(
  platform: PlatformId,
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  switch (platform) {
    case 'kiro':
      return kiroState(profilePayload, credentialRawMetadata)
    case 'cursor':
      return cursorState(profilePayload, credentialRawMetadata)
    case 'gemini_cli':
      return geminiState(profilePayload, credentialRawMetadata)
    case 'codex':
      return codexState(profilePayload, credentialRawMetadata)
    case 'windsurf':
      return copilotState(profilePayload, credentialRawMetadata)
    case 'github_copilot':
      return copilotState(profilePayload, credentialRawMetadata)
    case 'codebuddy':
    case 'codebuddy_cn':
      return codebuddyState(profilePayload, credentialRawMetadata)
    case 'qoder':
      return qoderState(profilePayload, credentialRawMetadata)
    case 'trae':
      return traeState(profilePayload, credentialRawMetadata)
    case 'zed':
      return zedState(profilePayload, credentialRawMetadata)
    default:
      return undefined
  }
}

/**
 * Build state from a live fetch result, preferring the per-platform profile
 * parser when provider_payload is a non-empty object.
 */
export function fromFetchResultForPlatform(
  platform: PlatformId,
  result: QuotaFetchResult,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState {
  const usePayload =
    (result.outcome === 'success' || result.outcome === 'stale') &&
    !isJsonNull(result.providerPayload) &&
    !isEmptyObject(result.providerPayload)

  const state = usePayload
    ? fromAccountProfile(platform, result.providerPayload, credentialRawMetadata) ??
      AccountQuotaState.fromFetchResult(result)
    : AccountQuotaState.fromFetchResult(result)

  state.fetchedAt = result.fetchedAt
  state.error = result.error
  if (result.freshness === 'stale') state.status = 'unknown'
  if (result.outcome === 'unsupported') state.status = 'unsupported'
  if (result.outcome === 'failed') state.status = 'error'
  if (!isJsonNull(result.providerPayload)) {
    state.providerPayload = sanitizeProviderPayload(result.providerPayload)
  }
  return state
}
