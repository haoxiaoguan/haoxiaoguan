import type { PlatformId } from './platform-id'
import type { Credential } from './credential'

// Cross-context ports the account application layer depends on. These are
// implemented OUTSIDE this context (credential ctx + agents layer) and injected
// at container construction. Keeping them here (consumer-defined ports) lets the
// account context compile and unit-test in isolation with fakes.

// ---------------------------------------------------------------------------
// CredentialStorePort — owned by the credential context.
//
// The source `credentials` table stores an AES-256-GCM envelope. The account
// service only needs to store/retrieve/delete the credential plaintext keyed by
// accountId; the credential context handles envelope encryption internally
// (crypto + key id + version + AAD {provider, accountId, createdAt}). We pass the
// platform so the store can build the envelope AAD.
// ---------------------------------------------------------------------------
export interface CredentialStorePort {
  /** Encrypt + persist the credential for an account. */
  store(accountId: string, platform: PlatformId, credential: Credential): Promise<void>
  /** Retrieve + decrypt the credential for an account (null if absent). */
  retrieve(accountId: string): Promise<Credential | null>
  /** Delete the stored credential for an account (no-op if absent). */
  delete(accountId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// CredentialInjectionPort — owned by the agents layer (CredentialInjection
// capability). Writes the decrypted credential into the target IDE's on-disk
// config file (storage.json / hosts.json / auth.json / credentials.json). The
// adapter resolves the per-OS path itself.
// ---------------------------------------------------------------------------
export interface LaunchOptions {
  launchOnSwitch: boolean
  executableOverride?: string
}

export interface CredentialInjectionPort {
  /** Inject the credential into the platform's config file on disk. */
  inject(platform: PlatformId, credential: Credential): Promise<void>
}

// ---------------------------------------------------------------------------
// CredentialInjectorRegistry — resolves the injection capability per platform.
// Used by switch paths to look up the per-platform injector.
// ---------------------------------------------------------------------------
export interface CredentialInjectorRegistry {
  /** Returns the injector for a platform, or undefined if unsupported. */
  injector(platform: PlatformId): CredentialInjectionPort | undefined
}

// ---------------------------------------------------------------------------
// CredentialRefresher — per-platform token refresh used by the switch path.
// 切换前先把过期/将过期的 OAuth token 换新（对照 cockpit-tools 切换前的
// refresh_managed_account_locked），否则过期账号永远切不动。
// ---------------------------------------------------------------------------
export interface CredentialRefresher {
  /**
   * Refresh the credential if it needs it. Returns the SAME instance when no
   * refresh was necessary; returns a NEW Credential (caller persists it) after
   * a successful refresh. Throws when a needed refresh fails.
   */
  refreshIfNeeded(credential: Credential): Promise<Credential>
}

export interface CredentialRefresherRegistry {
  refresher(platform: PlatformId): CredentialRefresher | undefined
}

// ---------------------------------------------------------------------------
// PlatformSwitchLifecycle — brackets the credential injection with platform
// process control（Codex 桌面 App 的「停-写-启」：运行中的 App 退出时会反写
// auth.json，必须先停掉再写，写完按需拉起）。
// ---------------------------------------------------------------------------
export interface SwitchLifecycleToken {
  /** afterInject 是否需要拉起平台 App。 */
  relaunch: boolean
}

export interface PlatformSwitchLifecycle {
  /** 注入前调用；停不掉运行中的 App 时抛错中止切换。 */
  beforeInject(): Promise<SwitchLifecycleToken>
  /** 注入后（无论注入成败）调用，按 token 决定是否拉起 App。 */
  afterInject(token: SwitchLifecycleToken): Promise<void>
}

export interface SwitchLifecycleRegistry {
  lifecycle(platform: PlatformId): PlatformSwitchLifecycle | undefined
}
