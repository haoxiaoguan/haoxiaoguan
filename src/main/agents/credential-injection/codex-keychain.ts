import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'

const execFileAsync = promisify(execFile)

// macOS 上新版 Codex 优先把登录凭证存 Keychain（service="Codex Auth"，
// account = "cli|" + sha256(canonical CODEX_HOME)[..16]），auth.json 只是回退。
// 切号只写 auth.json 会被 Keychain 里的旧凭证盖住，必须同步 upsert（对照
// cockpit-tools codex_account.rs::write_codex_keychain_to_dir）。API Key 账号
// 不走 Keychain（auth_mode=apikey 由 auth.json 直接生效），调用方负责跳过。

const CODEX_KEYCHAIN_SERVICE = 'Codex Auth'

/** Codex Keychain 凭证同步端口（抽象出来便于单测注入假实现）。 */
export interface CodexKeychainSync {
  /** 将 auth.json 同款 JSON 写入（upsert）Keychain。失败抛错，由调用方降级。 */
  write(secretJson: string): Promise<void>
}

/** Rust build_codex_keychain_account 的等价实现：canonicalize 失败时退原始路径。 */
export function codexKeychainAccount(codexHome: string): string {
  let resolved = codexHome
  try {
    resolved = realpathSync(codexHome)
  } catch {
    // 目录不存在等 → 用原始路径（与 Rust canonicalize().unwrap_or 一致）。
  }
  const digest = createHash('sha256').update(resolved).digest('hex')
  return `cli|${digest.slice(0, 16)}`
}

class MacCodexKeychainSync implements CodexKeychainSync {
  constructor(private readonly codexHome: string) {}

  async write(secretJson: string): Promise<void> {
    const account = codexKeychainAccount(this.codexHome)
    await execFileAsync('security', [
      'add-generic-password',
      '-U',
      '-s',
      CODEX_KEYCHAIN_SERVICE,
      '-a',
      account,
      '-w',
      secretJson,
    ])
  }
}

class NoopCodexKeychainSync implements CodexKeychainSync {
  async write(_secretJson: string): Promise<void> {
    // 非 macOS 无 Keychain，no-op。
  }
}

/** 工厂：macOS 返回真实实现，其它平台返回 no-op。 */
export function createCodexKeychainSync(codexHome: string): CodexKeychainSync {
  return process.platform === 'darwin' ? new MacCodexKeychainSync(codexHome) : new NoopCodexKeychainSync()
}
