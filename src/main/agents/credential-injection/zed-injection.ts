import { join } from 'node:path'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { atomicWrite } from '../../platform/fs/atomic-write'
import { dotDir } from '../../platform/persistence/paths'
import { createKeychainCommandRunner, type KeychainCommandRunner } from './mac-keychain'

// Zed 专用切换注入（对照 cockpit-tools zed_account::write_credentials_to_keychain）。
// Zed 桌面端在 macOS 从 Keychain 的 internet-password 读取登录（server=https://zed.dev，
// account=user_id，password=access_token），不读 ~/.zed 下的文件；因此切号必须写
// Keychain。非 macOS 回退到写 ~/.zed/credentials.json {"token"}（旧通用行为），
// 至少不静默失败。

const ZED_SERVER_URL = 'https://zed.dev'

function metaString(credential: Credential, keys: string[]): string | undefined {
  const meta = credential.rawMetadata
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const obj = meta as Record<string, JsonValue>
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return undefined
}

export class ZedCredentialInjectionPort implements CredentialInjectionPort {
  private readonly keychain: KeychainCommandRunner
  private readonly fallbackPath: string

  constructor(keychain?: KeychainCommandRunner, fallbackPath: string = join(dotDir('zed'), 'credentials.json')) {
    this.keychain = keychain ?? createKeychainCommandRunner()
    this.fallbackPath = fallbackPath
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const accessToken = credential.token.trim()
    if (accessToken.length === 0) {
      throw new Error('Zed 切换失败：access_token 为空')
    }
    // OAuth/local-scan 都把 Zed user_id 放进 rawMetadata.user_id。
    const userId = metaString(credential, ['user_id', 'userId', 'id']) ?? 'zed-user'

    if (this.keychain.available) {
      // 先删旧的 internet-password（可能不存在，忽略失败），再写新的（-U upsert）。
      await this.keychain.run(['delete-internet-password', '-s', ZED_SERVER_URL]).catch(() => undefined)
      await this.keychain.run([
        'add-internet-password',
        '-U',
        '-a',
        userId,
        '-s',
        ZED_SERVER_URL,
        '-w',
        accessToken,
      ])
      return
    }

    // 非 macOS：Zed 参考实现仅支持 macOS/Windows Keychain。这里回退写文件，保持行为可用。
    await atomicWrite(this.fallbackPath, JSON.stringify({ token: accessToken }, null, 2))
  }
}
