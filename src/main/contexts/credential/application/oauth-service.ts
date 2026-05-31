import { randomUUID } from 'node:crypto'
import type { PlatformId } from '../../account/domain/platform-id'
import { CredentialError } from '../domain/credential-error'
import type { ImportedCredentialMaterial, OAuthMode, OAuthPending } from '../domain/capability-types'
import type { ProviderRegistry } from '../domain/provider-registry'
import type { PendingOAuth, PendingOAuthRepository } from '../domain/pending-repository'

// OAuthService — cross-provider OAuth flow orchestrator. 对应
// credential::application::oauth_service::OAuthService.
//
// Responsibilities:
//   1. dispatch to the provider's OAuthCapability to start the flow + build the
//      pending handle (authorize_url, redirect_path, bound_port),
//   2. persist the pending (state + code_verifier) so it survives a restart,
//   3. on callback, look up the provider via the persisted pending record and
//      call completeOAuth, then delete the pending record (replay protection).
//
// The capability owns the per-provider mechanics (loopback callback server /
// polling / device flow). This service never busy-polls itself — completeOAuth
// awaits the capability which resolves when the callback fires (or times out).

const DEFAULT_PENDING_TTL_MINUTES = 10

export class OAuthService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly pending: PendingOAuthRepository,
  ) {}

  /** Start a provider OAuth flow; returns the pending handle for the frontend. */
  async start(provider: PlatformId, mode: OAuthMode): Promise<OAuthPending> {
    const cap = this.registry.oauth(provider)
    if (!cap) {
      throw CredentialError.unsupportedSource(provider, 'oauth')
    }
    const pending = await cap.startOAuth(mode)

    const now = new Date()
    const record: PendingOAuth = {
      id: pending.pendingId,
      provider,
      state: pending.state,
      codeVerifier: pending.codeVerifier,
      redirectPath: pending.redirectPath,
      boundPort: pending.boundPort,
      createdAt: now,
      expiresAt: new Date(now.getTime() + DEFAULT_PENDING_TTL_MINUTES * 60_000),
    }
    await this.pending.save(record)
    return pending
  }

  /** Complete OAuth with the callback code; returns normalised material. */
  async complete(pendingId: string, code: string): Promise<ImportedCredentialMaterial> {
    const record = await this.pending.findById(pendingId)
    if (!record) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }
    const cap = this.registry.oauth(record.provider)
    if (!cap) {
      throw CredentialError.unsupportedSource(record.provider, 'oauth')
    }
    const material = await cap.completeOAuth(pendingId, code)
    // Delete immediately after success to prevent replay.
    await this.pending.delete(pendingId)
    return material
  }

  /** Periodic cleanup of expired pending sessions. Returns the count purged. */
  async purgeExpired(): Promise<number> {
    return this.pending.purgeExpired(new Date())
  }

  /** Allocate a fresh pending id (used by capabilities that need an id up-front). */
  static newPendingId(): string {
    return randomUUID()
  }
}
