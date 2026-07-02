import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'

// Zed local-scan capability. Zed stores its login in the macOS Keychain as an
// internet-password (server=https://zed.dev, account=user_id, password=access
// token) — NOT in a file. Mirrors cockpit-tools zed_account::
// read_credentials_from_keychain: read the acct (user_id) from the metadata
// dump and the password (-w) separately. macOS only; other platforms return [].
// rawMetadata carries user_id so the zed profile derivation gets a stable id.

const execFileAsync = promisify(execFile)
const ZED_SERVER_URL = 'https://zed.dev'

// security 的元数据输出里 acct 形如：  "acct"<blob>="user-id-value"
function parseAccountFromMetadata(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const marker = '"acct"<blob>="'
    const idx = line.indexOf(marker)
    if (idx < 0) continue
    const rest = line.slice(idx + marker.length)
    const end = rest.indexOf('"')
    const value = end >= 0 ? rest.slice(0, end) : rest
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

export class ZedLocalImportCapability implements LocalImportCapability {
  constructor(private readonly serverUrl: string = ZED_SERVER_URL) {}

  provider(): PlatformId {
    return 'zed'
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    if (process.platform !== 'darwin') return []

    // 1) 元数据（含 acct=user_id）。找不到条目 → 未登录。
    let userId: string | undefined
    try {
      const { stdout } = await execFileAsync('security', ['find-internet-password', '-s', this.serverUrl])
      userId = parseAccountFromMetadata(stdout)
    } catch {
      return []
    }
    if (!userId) return []

    // 2) 密码（access_token）。
    let accessToken: string | undefined
    try {
      const { stdout } = await execFileAsync('security', [
        'find-internet-password',
        '-s',
        this.serverUrl,
        '-w',
      ])
      const t = stdout.trim()
      accessToken = t.length > 0 ? t : undefined
    } catch {
      return []
    }
    if (!accessToken) return []

    const rawMetadata: JsonValue = { user_id: userId, access_token: accessToken }
    return [
      {
        provider: 'zed',
        email: userId,
        accessToken,
        refreshToken: undefined,
        expiresAt: undefined,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}
