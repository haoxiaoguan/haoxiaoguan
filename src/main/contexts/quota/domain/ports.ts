// Domain repository ports + cross-context ports for the quota application service.
//
// 对应: QuotaCacheRepository, QuotaStateRepository, LiveQuotaFetcher,
// plus the slices of AccountRepository / CredentialRepository / CryptoServiceTrait
// the quota service depends on. The account/credential contexts implement the
// cross-context ports; quota implements the two cache repositories itself.

import type { JsonValue } from '../../account/domain/platform-account-profile'
import type { Account } from '../../account/domain/account'
import type { Credential } from '../../account/domain/credential'
import type { PlatformId } from './platform-id'
import type { QuotaInfo } from './quota'
import type { AccountQuotaState } from './quota-state'
import type { QuotaFetchResult } from './capabilities'

/** quota_cache repository (composite PK account_id+model). */
export interface QuotaCacheRepository {
  get(accountId: string): Promise<QuotaInfo | null>
  /** Delete-all-for-account then re-insert each model (wrapped in a transaction). */
  save(quota: QuotaInfo): Promise<void>
  delete(accountId: string): Promise<void>
}

/** account_quota_state repository (single row per account, upsert on conflict). */
export interface QuotaStateRepository {
  get(accountId: string): Promise<AccountQuotaState | null>
  save(accountId: string, state: AccountQuotaState): Promise<void>
  delete(accountId: string): Promise<void>
}

/** Live quota fetch request. 对应 QuotaFetchRequest. */
export interface QuotaFetchRequest {
  accountId: string
  platform: PlatformId
  credential: Credential
  profilePayload: JsonValue
}

/** Dispatches a per-platform live HTTP fetch. 对应 LiveQuotaFetcher. */
export interface LiveQuotaFetcher {
  fetch(request: QuotaFetchRequest): Promise<QuotaFetchResult>
}

// ---------------------------------------------------------------------------
// Cross-context ports (implemented by account + credential contexts).
// ---------------------------------------------------------------------------

/** Slice of the account repository the quota service reads/writes. */
export interface QuotaAccountRepository {
  findById(id: string): Promise<Account | null>
  findByPlatform(platform: PlatformId): Promise<Account[]>
  save(account: Account): Promise<void>
}

/** Store + retrieve the decrypted Credential for an account (credential context). */
export interface QuotaCredentialStore {
  retrieve(accountId: string): Promise<Credential | null>
  store(accountId: string, platform: PlatformId, credential: Credential): Promise<void>
}

/** Platform lookup so the credential store can build the AAD on store(). */
export interface QuotaPlatformLookup {
  platformOf(accountId: string): Promise<PlatformId | undefined>
}

export type { QuotaFetchResult }
