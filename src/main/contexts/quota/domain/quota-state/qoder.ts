// Qoder profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  genericStateFromProfile,
  pickNumberAny,
  quotaBalanceMetric,
  quotaUsageMetric,
  quotaUsageMetricWithRemaining,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics: QuotaMetric[] = []
  const credits = quotaUsageMetricWithRemaining(
    'credits',
    'Credits',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['creditsUsed'],
      ['credits_used'],
      ['auth_credit_usage_raw', 'userQuota', 'used'],
      ['authCreditUsageRaw', 'userQuota', 'used'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['creditsTotal'],
      ['credits_total'],
      ['auth_credit_usage_raw', 'userQuota', 'total'],
      ['authCreditUsageRaw', 'userQuota', 'total'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['creditsRemaining'],
      ['credits_remaining'],
      ['auth_credit_usage_raw', 'userQuota', 'remaining'],
      ['authCreditUsageRaw', 'userQuota', 'remaining'],
    ]),
    'credits',
    undefined,
  )
  if (credits) metrics.push(credits)

  const addon = quotaUsageMetric(
    'addon_credits',
    'Add-on Credits',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['auth_credit_usage_raw', 'addOnQuota', 'used'],
      ['auth_credit_usage_raw', 'addonQuota', 'used'],
      ['auth_credit_usage_raw', 'add_on_quota', 'used'],
      ['authCreditUsageRaw', 'addOnQuota', 'used'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['auth_credit_usage_raw', 'addOnQuota', 'total'],
      ['auth_credit_usage_raw', 'addonQuota', 'total'],
      ['auth_credit_usage_raw', 'add_on_quota', 'total'],
      ['authCreditUsageRaw', 'addOnQuota', 'total'],
    ]),
    'credits',
    undefined,
  )
  if (addon) metrics.push(addon)

  const shared = quotaBalanceMetric(
    'shared_package',
    'Shared Package',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['auth_credit_usage_raw', 'resourcePackage', 'used'],
      ['auth_credit_usage_raw', 'orgResourcePackage', 'used'],
      ['auth_credit_usage_raw', 'organizationResourcePackage', 'used'],
      ['auth_credit_usage_raw', 'sharedCreditPackage', 'used'],
      ['authCreditUsageRaw', 'resourcePackage', 'used'],
    ]),
    'credits',
  )
  if (shared) metrics.push(shared)

  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}
