import type { PlatformId } from '../../account/domain/platform-id'

// Pending OAuth + pending import domain entities and their repository ports.
// PendingOAuth / PendingImport back the pending_oauth / pending_import tables,
// implemented in infrastructure (MikroORM). Default pending TTL is 10 minutes;
// rows are purged by purgeExpired and deleted on success to prevent replay.

export interface PendingOAuth {
  id: string
  provider: PlatformId
  state: string
  codeVerifier: string
  redirectPath: string
  boundPort?: number
  createdAt: Date
  expiresAt: Date
}

export interface PendingImport {
  id: string
  provider: PlatformId
  payloadJson: string
  createdAt: Date
  expiresAt: Date
}

/** Repository port for pending_oauth. Upsert-on-conflict by id. */
export interface PendingOAuthRepository {
  save(pending: PendingOAuth): Promise<void>
  findById(id: string): Promise<PendingOAuth | null>
  delete(id: string): Promise<void>
  /** Delete every row whose expiresAt < now. Returns the count removed. */
  purgeExpired(now: Date): Promise<number>
}

/** Repository port for pending_import. Upsert-on-conflict by id. */
export interface PendingImportRepository {
  save(pending: PendingImport): Promise<void>
  findById(id: string): Promise<PendingImport | null>
  delete(id: string): Promise<void>
  purgeExpired(now: Date): Promise<number>
}
