import type { PlatformId } from '../../account/domain/platform-id'
import type { Credential } from './credential'
import type { StoredEnvelope } from './envelope'

// CredentialRepository port — owned by the credential context. Persists the
// AES-GCM envelope keyed by accountId via the envelope path (save_envelope /
// load_envelope), and additionally provides the account context's
// CredentialStorePort surface (store/retrieve/delete of the plaintext
// Credential) so it can REPLACE the account context's TEMP MikroOrmCredentialStore
// at integration.

export interface CredentialRepository {
  /** Encrypt + persist the credential for an account (builds the envelope). */
  store(accountId: string, platform: PlatformId, credential: Credential): Promise<void>
  /** Retrieve + decrypt the credential for an account (null if absent). */
  retrieve(accountId: string): Promise<Credential | null>
  /** Delete the stored credential (no-op if absent). */
  delete(accountId: string): Promise<void>
  /** Load the raw stored envelope (for validation capabilities). */
  loadEnvelope(accountId: string): Promise<StoredEnvelope | null>
}
