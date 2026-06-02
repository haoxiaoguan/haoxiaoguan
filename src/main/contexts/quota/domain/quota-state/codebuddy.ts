// Codebuddy profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  pickNumberAny,
  quotaUsageMetric,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics: QuotaMetric[] = []
  const userResource = quotaUsageMetric(
    'user_resource',
    'User Resource',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['quota_raw', 'userResource', 'used'],
      ['quotaRaw', 'userResource', 'used'],
      ['usage_raw', 'userResource', 'used'],
      ['usageRaw', 'userResource', 'used'],
      ['userResource', 'used'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['quota_raw', 'userResource', 'total'],
      ['quotaRaw', 'userResource', 'total'],
      ['usage_raw', 'userResource', 'total'],
      ['usageRaw', 'userResource', 'total'],
      ['userResource', 'total'],
    ]),
    'credits',
    undefined,
  )
  if (userResource) metrics.push(userResource)

  const resourcePackage = quotaUsageMetric(
    'resource_package',
    'Resource Package',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['quota_raw', 'resourcePackage', 'used'],
      ['quotaRaw', 'resourcePackage', 'used'],
      ['usage_raw', 'resourcePackage', 'used'],
      ['usageRaw', 'resourcePackage', 'used'],
      ['resourcePackage', 'used'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['quota_raw', 'resourcePackage', 'total'],
      ['quotaRaw', 'resourcePackage', 'total'],
      ['usage_raw', 'resourcePackage', 'total'],
      ['usageRaw', 'resourcePackage', 'total'],
      ['resourcePackage', 'total'],
    ]),
    'credits',
    undefined,
  )
  if (resourcePackage) metrics.push(resourcePackage)

  return stateFromMetrics(metrics, profilePayload)
}
