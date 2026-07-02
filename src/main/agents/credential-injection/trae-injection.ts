import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { atomicWrite } from '../../platform/fs/atomic-write'
import { appSupportDir } from '../../platform/persistence/paths'
import { byteCryptoEncryptV1 } from './trae-byte-crypto'

// Trae 专用切换注入（对照 cockpit-tools trae_account::inject_to_trae_at_path）。
//
// Trae 的登录态写在 storage.json（不是 state.vscdb），且 iCubeAuthInfo://* 值经
// ByteCrypto v1 加密后再存字符串：
//   iCubeAuthInfo://icube.cloudide       ByteCrypto( JSON(auth_raw) )
//   iCubeAuthInfo://icube-dc:{deviceId}  ByteCrypto( JSON({privateKeyPEM,publicKeyPEM}) )
//   iCubeEntitlementInfo://icube.cloudide  明文 JSON 字符串（可选）
//   iCubeServerData://icube.cloudide       明文 JSON 字符串（可选）
//   iCubeAuthInfo://usertag                usertag（有则原样写）
// auth_raw / deviceKeyPair / server_raw 均来自 OAuth 导入时保存的 rawMetadata。
// 通用 storage.serviceMachineId 注入对 Trae 完全无效。
//
// 注意：这里以「回写捕获到的 exchange 结果」为准（trae_auth_raw 含 accessToken/
// refreshToken/loginHost 等）；若某些 Trae 版本读取的字段名不同，需真机比对微调。

const AUTH_KEY = 'iCubeAuthInfo://icube.cloudide'
const DEVICE_KEY_PREFIX = 'iCubeAuthInfo://icube-dc:'
const ENTITLEMENT_KEY = 'iCubeEntitlementInfo://icube.cloudide'
const SERVER_KEY = 'iCubeServerData://icube.cloudide'
const USERTAG_KEY = 'iCubeAuthInfo://usertag'

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

function pick(root: Record<string, JsonValue> | undefined, paths: string[][]): string | undefined {
  if (!root) return undefined
  for (const path of paths) {
    let current: JsonValue | undefined = root
    let ok = true
    for (const key of path) {
      const obj = asObject(current)
      if (obj && key in obj) current = obj[key]
      else {
        ok = false
        break
      }
    }
    if (ok && typeof current === 'string' && current.trim().length > 0) return current.trim()
  }
  return undefined
}

export class TraeCredentialInjectionPort implements CredentialInjectionPort {
  private readonly storagePath: string

  constructor(storagePath?: string) {
    this.storagePath =
      storagePath ?? join(appSupportDir('Trae'), 'User', 'globalStorage', 'storage.json')
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const meta = asObject(credential.rawMetadata)
    const authRaw = asObject(meta?.trae_auth_raw)
    if (authRaw === undefined) {
      throw new Error('Trae 切换失败：缺少 trae_auth_raw（请通过 OAuth 重新导入）')
    }

    const root = this.readStorage()
    root[AUTH_KEY] = byteCryptoEncryptV1(JSON.stringify(authRaw))

    // 设备密钥对：privateKeyPEM/publicKeyPEM + deviceInfo.DeviceID 齐备才写。
    const deviceKeyPair = asObject(authRaw.deviceKeyPair)
    const deviceId = pick(authRaw, [
      ['deviceInfo', 'DeviceID'],
      ['deviceInfo', 'deviceId'],
      ['DeviceID'],
      ['deviceId'],
    ])
    if (deviceKeyPair !== undefined && deviceId !== undefined) {
      const privateKey = pick(deviceKeyPair, [['privateKeyPEM'], ['private_key_pem']])
      const publicKey = pick(deviceKeyPair, [['publicKeyPEM'], ['public_key_pem']])
      if (privateKey && publicKey) {
        root[`${DEVICE_KEY_PREFIX}${deviceId}`] = byteCryptoEncryptV1(
          JSON.stringify({ privateKeyPEM: privateKey, publicKeyPEM: publicKey }),
        )
      }
    }

    const entitlement = asObject(meta?.trae_entitlement_raw)
    if (entitlement !== undefined) root[ENTITLEMENT_KEY] = JSON.stringify(entitlement)

    const server = asObject(meta?.trae_server_raw)
    if (server !== undefined) root[SERVER_KEY] = JSON.stringify(server)

    const usertag = typeof meta?.trae_usertag_raw === 'string' ? meta.trae_usertag_raw.trim() : ''
    if (usertag.length > 0) root[USERTAG_KEY] = usertag

    await atomicWrite(this.storagePath, JSON.stringify(root, null, 2))
  }

  private readStorage(): Record<string, JsonValue> {
    if (!existsSync(this.storagePath)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.storagePath, 'utf8')) as unknown
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, JsonValue>)
        : {}
    } catch {
      // 解析失败不整文件覆盖：抛错交由上层提示（避免抹掉用户 storage.json）。
      throw new Error(`Trae storage.json 解析失败，已中止注入：${this.storagePath}`)
    }
  }
}
