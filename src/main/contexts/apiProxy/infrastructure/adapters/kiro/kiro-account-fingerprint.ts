// Kiro 账号指纹解析（profileArn / region / machineId）——纯函数，无副作用。
// 从 kiro-adapter.ts 抽出共享：聊天路径与模型目录（ListAvailableModels）用同一套解析，保证一致。
// 禁：class-property 箭头；禁动态 import()。
import { getMachineId } from '../../../../../platform/identity/machine-id'
import {
  normalizeRegion,
  parseRegionFromArn,
  KIRO_SOCIAL_PROFILE_ARN,
  KIRO_BUILDER_ID_PROFILE_ARN,
} from '../../../../../platform/net/kiro/kiro-identity-client'
import type { KiroAccountInfo, KiroCredential } from './kiro-ports'

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

export function pickString(src: unknown, keys: string[]): string | undefined {
  const obj = asRecord(src)
  if (obj === undefined) return undefined
  for (const k of keys) {
    const val = obj[k]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
  }
  return undefined
}

// profileArn：显式（profilePayload/rawMetadata）> provider 兜底（Github/Google→社交，否则 BuilderId）。
export function resolveProfileArn(account: KiroAccountInfo, cred: KiroCredential): string | undefined {
  const explicit =
    pickString(account.profilePayload, ['profileArn', 'profile_arn']) ??
    pickString(cred.rawMetadata, ['profileArn', 'profile_arn', 'arn'])
  if (explicit !== undefined) return explicit
  const provider = (account.loginProvider ?? pickString(cred.rawMetadata, ['provider']) ?? '').toLowerCase()
  if (provider === 'github' || provider === 'google') return KIRO_SOCIAL_PROFILE_ARN
  // 非社交（含企业/未知）→ BuilderId 兜底（与号小管额度路径一致）。
  return KIRO_BUILDER_ID_PROFILE_ARN
}

// region：显式 region（profilePayload/rawMetadata）优先；否则交给调用方用 parseRegionFromArn 兜底。
export function explicitRegion(account: KiroAccountInfo, cred: KiroCredential): string | undefined {
  return (
    pickString(account.profilePayload, ['region']) ??
    pickString(cred.rawMetadata, ['region', 'ssoRegion', 'sso_region'])
  )
}

// machineId：凭据/profilePayload 有则用，无则 per-account sha256 派生（P1-3 隔离）。
export function resolveMachineId(account: KiroAccountInfo, cred: KiroCredential): string {
  return (
    pickString(cred.rawMetadata, ['machineId', 'machine_id']) ??
    pickString(account.profilePayload, ['machineId', 'machine_id']) ??
    getMachineId(account.id)
  )
}

/** account+cred → ListAvailableModels 所需入参（与聊天路径同源解析，保证一致）。 */
export function resolveKiroModelFetchParams(
  account: KiroAccountInfo,
  cred: KiroCredential,
): { accessToken: string; region: string; profileArn?: string; machineId: string } {
  const profileArn = resolveProfileArn(account, cred)
  const region = normalizeRegion(explicitRegion(account, cred) ?? parseRegionFromArn(profileArn))
  const machineId = resolveMachineId(account, cred)
  return {
    accessToken: cred.token,
    region,
    machineId,
    ...(profileArn !== undefined ? { profileArn } : {}),
  }
}
