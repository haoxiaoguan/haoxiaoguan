import { join } from 'node:path'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { appDataDir } from '../../../platform/persistence/paths'
import { assertMasterKeyLength, type MasterKeyStore } from '../domain/master-key-store'
import { SyncError } from '../domain/sync-error'
import { getSafeStorage } from './secret-store'

// KeychainMasterKeyStore — production MasterKeyStore implementation.
// Delegates to the AES-GCM crypto service's global-key load/import.
//
// The "global key" is exactly what
// platform/crypto/crypto-service.ts::loadOrCreateMasterKey() persists: a 32-byte
// AES master key stored at appDataDir()/master.key.enc, encrypted with Electron
// safeStorage (raw base64 fallback when unavailable). This store reads/writes the
// SAME file + encoding so a key recovered from a remote sync round-trips into the
// running crypto layer (after the needs_restart relaunch reloads it).
//
//   load():  read master.key.enc → decrypt/decode → 32-byte Buffer.
//   store(): overwrite master.key.enc with the recovered key (last download step).
//
// Source parity notes:
//   - The Rust store also wrote a raw-binary file fallback at mode 0600. We keep
//     the platform's base64-in-safeStorage encoding (the only format the running
//     crypto service understands) and best-effort chmod 0600 the file on Unix.
//   - The legacy 'com.nomin.app' keychain entry is not relevant here: this port
//     uses a single file location and does not migrate from the Tauri keychain.

const MASTER_KEY_FILE = 'master.key.enc'

export class KeychainMasterKeyStore implements MasterKeyStore {
  /** Allow tests to point at a temp dir; defaults to the real appDataDir(). */
  constructor(private readonly dataDir: string = appDataDir()) {}

  private keyPath(): string {
    return join(this.dataDir, MASTER_KEY_FILE)
  }

  /** Read the current 32-byte global key (does NOT generate one). */
  async load(): Promise<Buffer> {
    let enc: Buffer
    try {
      enc = await readFile(this.keyPath())
    } catch (e) {
      throw SyncError.crypto(`无法读取全局密钥: ${(e as Error).message}`)
    }
    const ss = await getSafeStorage()
    let key: Buffer
    if (ss) {
      try {
        key = Buffer.from(ss.decryptString(enc), 'base64')
      } catch {
        // File may have been written in degraded raw-base64 mode.
        key = Buffer.from(enc.toString('utf8'), 'base64')
      }
    } else {
      key = Buffer.from(enc.toString('utf8'), 'base64')
    }
    if (key.length !== 32) {
      throw SyncError.crypto(`全局密钥长度非法: 期望 32 字节, 实际 ${key.length}`)
    }
    return key
  }

  /** Overwrite the global key with `key` (must be exactly 32 bytes). */
  async store(key: Buffer): Promise<void> {
    assertMasterKeyLength(key)
    await mkdir(this.dataDir, { recursive: true })
    const ss = await getSafeStorage()
    const path = this.keyPath()
    if (ss) {
      await writeFile(path, ss.encryptString(key.toString('base64')))
    } else {
      // Degraded parity with platform/crypto fallback: persist raw base64.
      await writeFile(path, key.toString('base64'), 'utf8')
    }
    // chmod 0600 (no-op / throws-harmlessly on Windows — match source intent).
    if (process.platform !== 'win32') {
      await chmod(path, 0o600).catch(() => {})
    }
  }
}
