import { SyncError } from './sync-error'

// MasterKeyStore — port for reading/writing the 32-byte global encryption key.
// 对应 modules/sync/domain/master_key_store.rs.
//
// On upload, load() returns the runtime master key to wrap into master.key.enc;
// on download (cross-device restore) store() writes the recovered key back. The
// production impl is keychain/safeStorage-backed; tests inject an in-memory one.
//
// The interface is async here (Node keychain/safeStorage access is async-leaning)
// whereas the Rust trait was sync; the orchestration awaits it either way.
export interface MasterKeyStore {
  /** Read the current 32-byte global key. */
  load(): Promise<Buffer>
  /** Write (overwrite) the global key. Must be exactly 32 bytes. */
  store(key: Buffer): Promise<void>
}

/** Guard used by store() implementations to enforce the 32-byte invariant. */
export function assertMasterKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw SyncError.crypto(`master key 长度必须为 32 字节, 实际 ${key.length}`)
  }
}
