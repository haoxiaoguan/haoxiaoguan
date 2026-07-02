import type { JsonValue } from '../../../account/domain/platform-account-profile'
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

// Gemini CLI OAuth — Google authorization-code loopback with the Gemini Code
// Assist desktop client (cockpit-tools modules/gemini_oauth.rs). rawMetadata
// mirrors the gemini profile derivation (gemini_auth_raw / selected_auth_type=
// oauth-personal).

const GEMINI_CONFIG: GoogleOAuthConfig = {
  provider: 'gemini_cli',
  clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
  clientSecret: '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',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],
  callbackPath: '/oauth2callback',
}

export class GeminiOAuthCapability extends GoogleLoopbackOAuthCapability {
  constructor(opts?: OAuthFetchOpts) {
    super(GEMINI_CONFIG, opts)
  }

  protected buildMaterial(
    token: GoogleTokenResponse,
    userInfo: GoogleUserInfo | undefined,
  ): ImportedCredentialMaterial {
    const { email, authId, name } = resolveGoogleIdentity(token, userInfo)
    const expiresAt = googleExpiresAt(token)
    const authRaw = googleAuthRaw(token, email, authId, expiresAt)
    if (name) authRaw.name = name
    const rawMetadata: JsonValue = {
      email,
      auth_id: authId ?? null,
      selected_auth_type: 'oauth-personal',
      gemini_auth_raw: authRaw,
    }
    return {
      provider: 'gemini_cli',
      email,
      accessToken: token.access_token ?? '',
      refreshToken: token.refresh_token,
      expiresAt,
      source: 'oauth',
      rawMetadata,
    }
  }
}
