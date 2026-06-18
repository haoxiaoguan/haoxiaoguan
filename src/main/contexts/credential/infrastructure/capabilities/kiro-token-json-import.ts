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
// This wraps the generic parser and runs the SAME identity enrichment the
// local-scan path uses (KiroLocalImportCapability), so pasted-JSON import
// behaves identically: by default skip the online check and import with a
// placeholder identity (stale local profile still voided); when the per-platform
// 「必须联网检查身份」toggle is on, confirm identity online and abort on failure.
export class KiroTokenJsonImportCapability implements FileImportCapability {
  // Kiro tolerates a refreshToken-only paste (no accessToken): the access token
  // is obtained by a refresh during enrichment. requireAccessToken=false.
  private readonly base = new TokenJsonFileImportCapability('kiro', false)

  constructor(
    // When false (default), the import skips the online identity check and uses a
    // placeholder identity; when true, identity is confirmed live and a failure
    // aborts the import. Accepts a resolver so the live per-platform app setting
    // (require_online_check_kiro) is read at import time; tests pass a plain boolean.
    private readonly requireOnlineOption: boolean | (() => boolean) = false,
    // Injectable transport for the identity enrichment call (tests only).
    private readonly fetchImpl?: FetchImpl,
  ) {}

  private get requireOnline(): boolean {
    return typeof this.requireOnlineOption === 'function'
      ? this.requireOnlineOption()
      : this.requireOnlineOption
  }

  provider(): PlatformId {
    return 'kiro'
  }

  async importFromJson(payload: string): Promise<ImportedCredentialMaterial> {
    const material = await this.base.importFromJson(payload)
    return enrichKiroMaterial(
      material,
      this.requireOnline
        ? { allowStale: false, fetchImpl: this.fetchImpl }
        : { skipOnline: true, fetchImpl: this.fetchImpl },
    )
  }
}
