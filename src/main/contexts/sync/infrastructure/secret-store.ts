import { dirname } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'

// safeStorage-backed secret store — the Electron equivalent of the source
// keychain password stores (modules/sync/infrastructure/{webdav,sync}_password_store.rs).
//
// The source used the OS keychain via the `keyring` crate (three separate
// service/user entries). Here every secret is encrypted with Electron
// `safeStorage` and persisted to its own file under appDataDir(), mirroring how
// platform/crypto/crypto-service.ts persists the master key. Secrets are NEVER
// written to settings.json and NEVER uploaded.
//
// When safeStorage is unavailable (headless/CI/no Electron), we degrade to raw
// utf8 just like the platform master-key fallback — this also makes the store
// unit-testable without an Electron runtime.

/**
 * Resolve Electron `safeStorage` if encryption is available; otherwise null
 * (degraded raw-utf8 mode). Static import (bytecode-safe); under vitest the
 * `electron` stub reports encryption unavailable, exercising the fallback.
 */
export function getSafeStorage(): typeof safeStorage | null {
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage : null
  } catch {
    return null
  }
}

/** Read/write/clear a single secret string. */
export interface SecretStore {
  /** Current secret, or null when unset. */
  get(): Promise<string | null>
  /** Persist (overwrite) the secret. */
  set(value: string): Promise<void>
  /** Remove the secret entirely (no-op when already absent). */
  clear(): Promise<void>
}

/**
 * File-backed secret store encrypted with Electron safeStorage. One instance per
 * secret (one file path). Mirrors the keychain entries:
 *   - WebDAV login password  (source service 'haoxiaoguan.webdav.password')
 *   - E2EE sync password     (source service 'haoxiaoguan.sync.password')
 */
export class SafeStorageSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<string | null> {
    let buf: Buffer
    try {
      buf = await readFile(this.filePath)
    } catch {
      // Missing file ⇒ unset (source maps keyring NoEntry → None).
      return null
    }
    const ss = getSafeStorage()
    if (ss) {
      try {
        return ss.decryptString(buf)
      } catch {
        // File written in degraded raw mode while safeStorage is now available.
        return buf.toString('utf8')
      }
    }
    return buf.toString('utf8')
  }

  async set(value: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const ss = getSafeStorage()
    if (ss) {
      await writeFile(this.filePath, ss.encryptString(value))
    } else {
      await writeFile(this.filePath, value, 'utf8')
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }
}
