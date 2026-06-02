import type { AccountRepository } from '../domain/account-repository'
import { profileFromImportMaterial } from '../domain/platform-profile'
import type { PlatformId } from '../domain/platform-id'
import { platformToFrontendId } from '../domain/platform-id'
import type { ImportService } from '../../credential/application/import-service'

// Platforms whose local login state we can READ (a registered LocalImport
// capability exists). The detector only covers these; others keep their current
// isActive untouched. Keep in sync with build-registry's registerLocalImport.
export const DETECT_PLATFORMS: readonly PlatformId[] = [
  'cursor',
  'codex',
  'kiro',
  'windsurf',
  'qoder',
  'trae',
  'codebuddy',
  'codebuddy_cn',
  'antigravity',
]

/** Per-platform detection outcome (frontend platform id). */
export interface DetectionResult {
  platform: string
  /** The account id now marked active for this platform, or null. */
  activeAccountId: string | null
  /** True when the detected local identity matched a stored account. */
  matched: boolean
}

/**
 * ActiveDetectionService — reverse-detects which stored account each agent/IDE
 * is ACTUALLY logged into right now, and rewrites accounts.is_active to match.
 *
 * The app's is_active flag is otherwise only set when the user switches inside
 * the app; it drifts from reality if the user changes the login in the IDE
 * directly. We close that gap by reading the IDE's local login state (reusing
 * the same LocalImport scanners the import flow uses), deriving its identityKey
 * via profileFromImportMaterial (identical to the stored accounts' key), and
 * matching by (platform, identityKey).
 *
 * Conservative by design: if a platform's local state can't be read (IDE not
 * installed / not logged in / locked db), we leave its is_active UNTOUCHED — an
 * unreadable state is not evidence of a logout, and clearing it would wrongly
 * drop the badge whenever the IDE simply isn't running.
 */
export class ActiveDetectionService {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly importService: ImportService,
    private readonly platforms: readonly PlatformId[] = DETECT_PLATFORMS,
  ) {}

  /** Detect across all covered platforms, with per-platform failure isolation. */
  async detectAll(): Promise<DetectionResult[]> {
    const settled = await Promise.all(
      this.platforms.map((p) =>
        this.detectPlatform(p).catch(
          (): DetectionResult => ({ platform: platformToFrontendId(p), activeAccountId: null, matched: false }),
        ),
      ),
    )
    return settled
  }

  private async detectPlatform(platform: PlatformId): Promise<DetectionResult> {
    const frontendId = platformToFrontendId(platform)

    // Read the IDE's current local login state. Empty / throw → unreadable;
    // stay conservative and leave is_active as-is (report current active).
    let detectedKey: string | undefined
    try {
      const materials = await this.importService.scanLocal(platform)
      if (materials.length > 0) {
        const m = materials[0]
        const profile = profileFromImportMaterial(platform, m.email, m.rawMetadata, m.accessToken)
        detectedKey = profile.identityKey
      }
    } catch {
      detectedKey = undefined
    }

    const accounts = await this.accountRepo.findByPlatform(platform)
    const current = accounts.find((a) => a.isActive) ?? null

    if (detectedKey === undefined) {
      // Unreadable local state — do not touch is_active (conservative).
      return { platform: frontendId, activeAccountId: current?.id ?? null, matched: false }
    }

    const match = accounts.find((a) => a.identityKey === detectedKey) ?? null

    if (match === null) {
      // The IDE is logged into an identity we don't have stored. The real login
      // is no longer any tracked account → clear a stale active badge.
      if (current !== null) {
        current.deactivate()
        await this.accountRepo.save(current)
      }
      return { platform: frontendId, activeAccountId: null, matched: false }
    }

    if (current !== null && current.id === match.id) {
      // Already correct — no write.
      return { platform: frontendId, activeAccountId: match.id, matched: true }
    }

    // Move the active flag to the real account (one active per platform).
    if (current !== null) {
      current.deactivate()
      await this.accountRepo.save(current)
    }
    match.activate()
    await this.accountRepo.save(match)
    return { platform: frontendId, activeAccountId: match.id, matched: true }
  }
}
