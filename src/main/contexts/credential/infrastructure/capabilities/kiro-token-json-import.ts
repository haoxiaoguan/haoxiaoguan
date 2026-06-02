import type { PlatformId } from '../../../account/domain/platform-id'
import type { FileImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import type { FetchImpl } from '../../../../platform/net/kiro/kiro-identity-client'
import { TokenJsonFileImportCapability } from './token-json-file-import'
import { enrichKiroMaterial } from './kiro-identity-enrichment'

// Kiro-specific token-JSON import. The generic TokenJsonFileImportCapability
// only parses the pasted JSON — for Kiro that yields a placeholder identity,
// because an enterprise (IdC) account's true identity (email/userId/plan) is
// NOT in the token blob (the access token is an opaque, non-JWT string). The
// authoritative source is a live getUsageLimits call.
//
// This wraps the generic parser and runs the SAME online identity enrichment
// the local-scan path uses (KiroLocalImportCapability), so pasted-JSON import
// behaves identically: confirm identity online, void any stale local profile,
// and — on failure — abort by default (or degrade to a placeholder when the
// allow_stale_kiro_import setting is on), never importing a leftover identity.
export class KiroTokenJsonImportCapability implements FileImportCapability {
  // Kiro tolerates a refreshToken-only paste (no accessToken): the access token
  // is obtained by a refresh during enrichment. requireAccessToken=false.
  private readonly base = new TokenJsonFileImportCapability('kiro', false)

  constructor(
    // When false (default), a failed live identity confirmation aborts the
    // import; when true, import proceeds with a placeholder identity. Accepts a
    // resolver so the live app setting (allow_stale_kiro_import) is read at
    // import time; tests pass a plain boolean.
    private readonly allowStaleOption: boolean | (() => boolean) = false,
    // Injectable transport for the identity enrichment call (tests only).
    private readonly fetchImpl?: FetchImpl,
  ) {}

  private get allowStale(): boolean {
    return typeof this.allowStaleOption === 'function'
      ? this.allowStaleOption()
      : this.allowStaleOption
  }

  provider(): PlatformId {
    return 'kiro'
  }

  async importFromJson(payload: string): Promise<ImportedCredentialMaterial> {
    const material = await this.base.importFromJson(payload)
    return enrichKiroMaterial(material, {
      allowStale: this.allowStale,
      fetchImpl: this.fetchImpl,
    })
  }
}
