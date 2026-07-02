import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { appDataDir, parseExpiresAt, pickString } from '../scan-helpers'
import { byteCryptoDecrypt } from '../../../../agents/credential-injection/trae-byte-crypto'

// Trae local-scan capability. Trae does NOT store its login in state.vscdb
// SecretStorage — it writes storage.json with iCubeAuthInfo://<provider> values
// wrapped by its private ByteCrypto v1 (base64). Mirrors cockpit-tools
// trae_account::read_local_trae_auth / payload_from_storage_root:
//   1. read {TraeData}/User/globalStorage/storage.json,
//   2. resolve the auth provider id (default icube.cloudide; else the first
//      iCubeAuthInfo://<id> key that isn't a device/usertag key),
//   3. read iCubeAuthInfo://<id> (plain JSON | JSON string | base64 ByteCrypto),
//   4. extract accessToken/refreshToken + user info; carry server/usertag raw.
// rawMetadata matches the trae profile derivation (trae_auth_raw / trae_server_raw
// / trae_usertag_raw + user_id/email/nickname) so it aligns with OAuth/import.

const AUTH_KEY_PREFIX = 'iCubeAuthInfo://'
const SERVER_KEY_PREFIX = 'iCubeServerData://'
const ENTITLEMENT_KEY_PREFIX = 'iCubeEntitlementInfo://'
const DEVICE_KEY_PREFIX = 'iCubeAuthInfo://icube-dc:'
const USERTAG_KEY = 'iCubeAuthInfo://usertag'
const DEFAULT_PROVIDER_ID = 'icube.cloudide'

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

// 存储值可能是：对象 / JSON 字符串 / base64(ByteCrypto 密文)。逐级解开为对象。
function parseValueOrCipher(value: unknown): Record<string, unknown> | undefined {
  const obj = asObject(value)
  if (obj !== undefined) return obj
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  try {
    return asObject(JSON.parse(trimmed))
  } catch {
    // 不是明文 JSON → 试 ByteCrypto 密文（base64）。
  }
  const decrypted = byteCryptoDecrypt(trimmed)
  if (decrypted === null) return undefined
  try {
    return asObject(JSON.parse(decrypted))
  } catch {
    return undefined
  }
}

export class TraeLocalImportCapability implements LocalImportCapability {
  constructor(private readonly storagePathOverride?: string) {}

  provider(): PlatformId {
    return 'trae'
  }

  private storagePath(): string {
    return (
      this.storagePathOverride ??
      join(appDataDir('Trae'), 'User', 'globalStorage', 'storage.json')
    )
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const path = this.storagePath()
    if (!existsSync(path)) return []
    let root: Record<string, unknown>
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      const obj = asObject(parsed)
      if (obj === undefined) return []
      root = obj
    } catch {
      return []
    }

    const providerId = resolveProviderId(root)
    // auth / server / entitlement 三类键，各自 providerId 优先、回退默认 icube.cloudide。
    const authRaw =
      parseValueOrCipher(root[`${AUTH_KEY_PREFIX}${providerId}`]) ??
      parseValueOrCipher(root[`${AUTH_KEY_PREFIX}${DEFAULT_PROVIDER_ID}`])
    const serverRaw =
      parseValueOrCipher(root[`${SERVER_KEY_PREFIX}${providerId}`]) ??
      parseValueOrCipher(root[`${SERVER_KEY_PREFIX}${DEFAULT_PROVIDER_ID}`])
    const entitlementRaw =
      parseValueOrCipher(root[`${ENTITLEMENT_KEY_PREFIX}${providerId}`]) ??
      parseValueOrCipher(root[`${ENTITLEMENT_KEY_PREFIX}${DEFAULT_PROVIDER_ID}`])

    // access token 可能在 auth，也可能在 server（对照参考的 pick 顺序）。
    const accessToken =
      pickString(authRaw, [
        ['accessToken'],
        ['access_token'],
        ['token'],
        ['data', 'accessToken'],
        ['data', 'access_token'],
        ['auth', 'accessToken'],
        ['auth', 'token'],
      ]) ??
      pickString(serverRaw, [
        ['accessToken'],
        ['access_token'],
        ['token'],
        ['data', 'accessToken'],
        ['data', 'token'],
      ])
    if (!accessToken) return []

    const refreshToken = pickString(authRaw, [
      ['refreshToken'],
      ['refresh_token'],
      ['RefreshToken'],
      ['exchangeResponse', 'Result', 'RefreshToken'],
      ['data', 'refreshToken'],
      ['data', 'refresh_token'],
    ])

    // 真实邮箱要含 '@'（Trae 的 account.email 可能只是用户名，如 "RuffianLiu"）。
    const realEmail =
      pickEmail(authRaw, [
        ['email'],
        ['account', 'email'],
        ['account', 'nonPlainTextEmail'],
        ['NonPlainTextEmail'],
        ['data', 'email'],
        ['user', 'email'],
        ['userInfo', 'email'],
      ]) ?? pickEmail(serverRaw, [['email'], ['data', 'email'], ['user', 'email']])

    const userId =
      pickString(authRaw, [
        ['userId'],
        ['user_id'],
        ['uid'],
        ['id'],
        ['data', 'userId'],
        ['data', 'uid'],
        ['user', 'id'],
      ]) ??
      pickString(serverRaw, [
        ['userId'],
        ['user_id'],
        ['uid'],
        ['id'],
        ['account', 'uid'],
        ['data', 'userId'],
        ['data', 'uid'],
        ['user', 'id'],
      ])

    const nickname =
      pickString(authRaw, [
        ['account', 'username'],
        ['nickname'],
        ['name'],
        ['displayName'],
        ['data', 'nickname'],
        ['user', 'nickname'],
        ['user', 'name'],
      ]) ??
      pickString(serverRaw, [
        ['account', 'username'],
        ['nickname'],
        ['name'],
        ['displayName'],
        ['data', 'nickname'],
        ['user', 'name'],
      ])

    // 展示名/邮箱：真实邮箱优先，其次用户名/昵称，再退 userId，最后占位。
    const email = realEmail ?? nickname ?? userId ?? 'trae-user'

    const tokenType = pickString(authRaw, [
      ['tokenType'],
      ['token_type'],
      ['TokenType'],
      ['data', 'tokenType'],
    ])

    const expiresAt = parseExpiresAt(
      firstDefined(authRaw, [
        ['expiresAt'],
        ['expiredAt'],
        ['expires_at'],
        ['TokenExpireAt'],
        ['exchangeResponse', 'Result', 'TokenExpireAt'],
        ['data', 'expiresAt'],
      ]) ?? firstDefined(serverRaw, [['expiresAt'], ['expires_at'], ['data', 'expiresAt']]),
    )

    const planType =
      pickString(entitlementRaw, [
        ['identityStr'],
        ['identity_str'],
        ['user_pay_identity_str'],
        ['entitlementInfo', 'identityStr'],
        ['data', 'user_pay_identity_str'],
      ]) ??
      pickString(serverRaw, [
        ['entitlementInfo', 'identityStr'],
        ['identityStr'],
        ['data', 'entitlementInfo', 'identityStr'],
      ])
    const planResetAt = parseExpiresAt(
      firstDefined(entitlementRaw, [
        ['detail', 'subscription_renew_time'],
        ['detail', 'subscriptionRenewTime'],
        ['data', 'detail', 'subscription_renew_time'],
        ['entitlementInfo', 'detail', 'subscription_renew_time'],
        ['entitlementInfo', 'detail', 'subscriptionRenewTime'],
      ]),
    )

    const status =
      pickString(authRaw, [['status'], ['data', 'status'], ['loginStatus']]) ??
      pickString(serverRaw, [['status'], ['data', 'status']])
    const statusReason =
      pickString(authRaw, [['statusReason'], ['status_reason'], ['message'], ['data', 'message']]) ??
      pickString(serverRaw, [['statusReason'], ['status_reason'], ['message']])

    const usertagRaw = typeof root[USERTAG_KEY] === 'string' ? (root[USERTAG_KEY] as string) : undefined
    const loginHost = pickString(authRaw, [['loginHost'], ['host']])

    const rawMetadata: JsonValue = {
      email,
      user_id: userId ?? null,
      nickname: nickname ?? null,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_type: tokenType ?? null,
      plan_type: planType ?? null,
      plan_reset_at: planResetAt ? Math.floor(planResetAt.getTime() / 1000) : null,
      status: status ?? null,
      status_reason: statusReason ?? null,
      trae_auth_raw: (authRaw ?? null) as JsonValue,
      trae_server_raw: (serverRaw ?? null) as JsonValue,
      trae_entitlement_raw: (entitlementRaw ?? null) as JsonValue,
      trae_usertag_raw: usertagRaw ?? null,
      ...(loginHost !== undefined ? { login_host: loginHost } : {}),
    }

    return [
      {
        provider: 'trae',
        email,
        accessToken,
        refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}

// email 需含 '@'，否则丢弃（对照 normalize_email）。
function pickEmail(root: Record<string, unknown> | undefined, paths: string[][]): string | undefined {
  const v = pickString(root, paths)
  if (v === undefined) return undefined
  return v.includes('@') ? v.toLowerCase() : undefined
}

// 取第一个存在的原始值（供时间戳解析：数字/字符串/嵌套路径）。
function firstDefined(root: Record<string, unknown> | undefined, paths: string[][]): unknown {
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
    if (ok && cur !== undefined && cur !== null) return cur
  }
  return undefined
}

// 解析 storage.json 里的 auth provider id：优先 iCubeAuthInfo://<id>（排除设备/usertag 键），
// 否则回退默认 icube.cloudide。
function resolveProviderId(root: Record<string, unknown>): string {
  for (const key of Object.keys(root)) {
    if (!key.startsWith(AUTH_KEY_PREFIX)) continue
    if (key.startsWith(DEVICE_KEY_PREFIX) || key === USERTAG_KEY) continue
    const id = key.slice(AUTH_KEY_PREFIX.length).trim()
    if (id.length > 0) return id
  }
  return DEFAULT_PROVIDER_ID
}
