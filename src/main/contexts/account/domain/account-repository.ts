import type { Account } from './account'
import type { PlatformId } from './platform-id'

// AccountRepository port — implemented in infrastructure (MikroORM).
// 对应 AccountRepository trait.
export interface AccountRepository {
  findById(id: string): Promise<Account | null>
  findByPlatform(platform: PlatformId): Promise<Account[]>
  findActiveByPlatform(platform: PlatformId): Promise<Account | null>
  findByTags(tags: string[]): Promise<Account[]>
  save(account: Account): Promise<void>
  delete(id: string): Promise<void>
  /** Existence check by (platform, normalized identity_key). */
  existsByIdentifier(platform: PlatformId, identity: string): Promise<boolean>
}
