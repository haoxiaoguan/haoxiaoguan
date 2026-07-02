import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { parseExpiresAt, pickString, stateVscdbPath } from '../scan-helpers'
import { decodeSecretStorageValue } from '../vscode-secret-storage'
import { readVscdbItem } from '../vscdb-reader'

// Qoder local-scan capability. Qoder's login lives in state.vscdb as THREE
// encrypted SecretStorage items with BARE keys (not the {"extensionId",...}
// JSON form):
//   secret://aicoding.auth.userInfo     → { id, name, token, refreshToken,
//                                          expireTime, email, userTag, ... }
//   secret://aicoding.auth.userPlan     → { user_type, plan_tier_name, ... }
//   secret://aicoding.auth.creditUsage  → { userQuota:{total,used,remaining}, ... }
// Mirrors cockpit-tools qoder_account::import_from_local. rawMetadata matches
// the qoder profile derivation + qoder injection shape (auth_user_info_raw /
// auth_user_plan_raw / auth_credit_usage_raw + user_id/display_name/plan_type/
// credits_*), so import → display → switch write-back are symmetric.

const KEY_USER_INFO = 'secret://aicoding.auth.userInfo'
const KEY_USER_PLAN = 'secret://aicoding.auth.userPlan'
const KEY_CREDIT_USAGE = 'secret://aicoding.auth.creditUsage'

type Decode = (rawValue: string, mode: 'qoder') => Promise<string>

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function pickNum(root: Record<string, unknown> | undefined, paths: string[][]): number | undefined {
  if (!root) return undefined
  for (const path of paths) {
    let cur: unknown = root
    let ok = true
    for (const key of path) {
      const obj = asObject(cur)
      if (obj && key in obj) cur = obj[key]
      else {
        ok = false
        break
      }
    }
    if (ok && typeof cur === 'number' && Number.isFinite(cur)) return cur
  }
  return undefined
}

export class QoderLocalImportCapability implements LocalImportCapability {
  constructor(
    private readonly stateDbPathOverride?: string,
    private readonly decode: Decode = decodeSecretStorageValue,
  ) {}

  provider(): PlatformId {
    return 'qoder'
  }

  private dbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath('Qoder')
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.dbPath()
    const userInfo = await this.readSecretJson(dbPath, KEY_USER_INFO)
    const userPlan = await this.readSecretJson(dbPath, KEY_USER_PLAN)
    const creditUsage = await this.readSecretJson(dbPath, KEY_CREDIT_USAGE)
    if (userInfo === undefined && userPlan === undefined && creditUsage === undefined) return []

    const accessToken = pickString(userInfo, [['token'], ['access_token'], ['accessToken']])
    if (!accessToken) return []
    const refreshToken = pickString(userInfo, [['refreshToken'], ['refresh_token']])

    const email =
      pickString(userInfo, [['email'], ['mail']]) ??
      pickString(userPlan, [['email'], ['mail']]) ??
      pickString(creditUsage, [['email'], ['mail']]) ??
      'unknown@qoder.local'
    const userId =
      pickString(userInfo, [['uid'], ['user_id'], ['userId'], ['id']]) ??
      pickString(creditUsage, [['userId'], ['user_id'], ['uid'], ['id']])
    const displayName = pickString(userInfo, [
      ['name'],
      ['nickname'],
      ['display_name'],
      ['displayName'],
      ['username'],
    ])
    const planType =
      pickString(userPlan, [
        ['plan'],
        ['plan_type'],
        ['planType'],
        ['plan_tier_name'],
        ['planTierName'],
        ['tier'],
        ['tier_name'],
        ['user_type'],
      ]) ?? pickString(userInfo, [['userTag'], ['userType']])

    const creditsUsed = pickNum(creditUsage, [['userQuota', 'used'], ['used']])
    const creditsTotal = pickNum(creditUsage, [['userQuota', 'total'], ['total']])
    const creditsRemaining = pickNum(creditUsage, [['userQuota', 'remaining'], ['remaining']])
    const creditsUsagePercent = pickNum(creditUsage, [
      ['userQuota', 'percentage'],
      ['totalUsagePercentage'],
    ])

    // expireTime 是字符串毫秒时间戳。
    const expiresAt = parseExpiresAt(userInfo?.expireTime ?? userInfo?.expiresAt)

    const rawMetadata: JsonValue = {
      email: email.toLowerCase(),
      user_id: userId ?? null,
      display_name: displayName ?? null,
      plan_type: planType ?? null,
      credits_used: creditsUsed ?? null,
      credits_total: creditsTotal ?? null,
      credits_remaining: creditsRemaining ?? null,
      credits_usage_percent: creditsUsagePercent ?? null,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      auth_user_info_raw: (userInfo ?? null) as JsonValue,
      auth_user_plan_raw: (userPlan ?? null) as JsonValue,
      auth_credit_usage_raw: (creditUsage ?? null) as JsonValue,
    }

    return [
      {
        provider: 'qoder',
        email: email.toLowerCase(),
        accessToken,
        refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }

  private async readSecretJson(
    dbPath: string,
    key: string,
  ): Promise<Record<string, unknown> | undefined> {
    const rawValue = readVscdbItem(dbPath, key)
    if (!rawValue) return undefined
    try {
      const decoded = await this.decode(rawValue, 'qoder')
      return asObject(JSON.parse(decoded))
    } catch {
      return undefined
    }
  }
}
