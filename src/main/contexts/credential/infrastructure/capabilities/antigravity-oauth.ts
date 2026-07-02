import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import {
  GoogleLoopbackOAuthCapability,
  googleAuthRaw,
  googleExpiresAt,
  resolveGoogleIdentity,
  type GoogleOAuthConfig,
  type GoogleTokenResponse,
  type GoogleUserInfo,
  type OAuthFetchOpts,
} from './google-oauth'

// Antigravity OAuth — Google authorization-code loopback with the Antigravity
// desktop client (cockpit-tools modules/oauth.rs). Shared by both the legacy
// "antigravity" client and the new "antigravity_ide" client (same Google OAuth
// app; only the target install differs). rawMetadata mirrors the antigravity
// profile derivation (antigravity_oauth_raw / antigravity_user_raw /
// selected_auth_type=google).

type AntigravityPlatform = 'antigravity' | 'antigravity_ide'

// Shared with antigravity-system-credential.ts, which refreshes the legacy
// (v2.0+) desktop client's Keychain-stored token through this same Google
// client — the OS credential store only holds the raw token, not identity.
export const ANTIGRAVITY_GOOGLE_CLIENT = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
}

function configFor(provider: AntigravityPlatform): GoogleOAuthConfig {
  return {
    provider,
    ...ANTIGRAVITY_GOOGLE_CLIENT,
    scopes: [
      'openid',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs',
    ],
    callbackPath: '/oauth-callback',
    extraAuthParams: { prompt: 'consent' },
  }
}

export class AntigravityOAuthCapability extends GoogleLoopbackOAuthCapability {
  constructor(
    private readonly platform: AntigravityPlatform = 'antigravity',
    opts?: OAuthFetchOpts,
  ) {
    super(configFor(platform), opts)
  }

  protected buildMaterial(
    token: GoogleTokenResponse,
    userInfo: GoogleUserInfo | undefined,
  ): ImportedCredentialMaterial {
    const { email, authId, name } = resolveGoogleIdentity(token, userInfo)
    const expiresAt = googleExpiresAt(token)
    const userRaw: Record<string, JsonValue> = { email }
    if (authId) userRaw.id = authId
    if (name) userRaw.name = name
    const rawMetadata: JsonValue = {
      email,
      auth_id: authId ?? null,
      selected_auth_type: 'google',
      oauth_client_key: 'antigravity_enterprise',
      antigravity_oauth_raw: googleAuthRaw(token, email, authId, expiresAt),
      antigravity_user_raw: userRaw,
    }
    return {
      provider: this.platform as PlatformId,
      email,
      accessToken: token.access_token ?? '',
      refreshToken: token.refresh_token,
      expiresAt,
      source: 'oauth',
      rawMetadata,
    }
  }
}
