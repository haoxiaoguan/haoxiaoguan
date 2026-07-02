import {
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
  randomUUID,
} from 'node:crypto'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import {
  EPHEMERAL_PORT,
  LoopbackServer,
  type CallbackPayload,
} from '../../../../platform/oauth/loopback-server'
import type { OAuthCapability } from '../../domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { normalizeNonEmpty } from './oauth-http'

// Zed OAuth (loopback + RSA-encrypted callback token). Ported from cockpit-tools
// modules/zed_oauth.rs:
//   1. generate a 2048-bit RSA keypair, bind an ephemeral 127.0.0.1 port,
//   2. open https://zed.dev/native_app_signin?native_app_port=&native_app_public_key=,
//   3. Zed redirects to http://127.0.0.1:{port}/?user_id=&access_token=<RSA b64>,
//   4. RSA-decrypt (OAEP-SHA256, fallback PKCS1v15) → the real access token.
// There is no refresh token in this flow; the profile/quota layer enriches the
// rest from user_id + access_token.

const ZED_SIGNIN_URL = 'https://zed.dev/native_app_signin'
const CALLBACK_PATH = '/'
const OAUTH_TIMEOUT_MS = 600_000

interface PendingZed {
  server: LoopbackServer
  privateKeyDer: Buffer
  callback: Promise<CallbackPayload>
  expiresAt: number
}

function b64urlNoPad(buf: Buffer): string {
  return buf.toString('base64url')
}

function decodeUrlSafeB64(value: string): Buffer {
  // Node's base64 decoder accepts URL-safe alphabet and tolerates missing padding.
  return Buffer.from(value, 'base64url')
}

export class ZedOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingZed>()
  private readonly signinUrl: string

  constructor(opts?: { signinUrl?: string }) {
    this.signinUrl = opts?.signinUrl ?? ZED_SIGNIN_URL
  }

  provider(): PlatformId {
    return 'zed'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('zed', 'oauth')
    }
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'der' },
      privateKeyEncoding: { type: 'pkcs1', format: 'der' },
    })
    const publicKeyB64 = b64urlNoPad(publicKey as unknown as Buffer)

    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind([EPHEMERAL_PORT])
    } catch {
      throw CredentialError.oauthPortInUse(0)
    }
    const pendingId = randomUUID()
    const authorizeUrl =
      `${this.signinUrl}?native_app_port=${boundPort}` +
      `&native_app_public_key=${encodeURIComponent(publicKeyB64)}`
    const callback = server.registerPath(CALLBACK_PATH)

    this.pending.set(pendingId, {
      server,
      privateKeyDer: privateKey as unknown as Buffer,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: CALLBACK_PATH,
      boundPort,
      // Zed's callback carries no state param; use the login id as a placeholder.
      state: pendingId,
      codeVerifier: '',
    }
  }

  async completeOAuth(pendingId: string, _code: string): Promise<ImportedCredentialMaterial> {
    const state = this.pending.get(pendingId)
    if (!state) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }
    let timeoutHandle: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(CredentialError.providerError('Zed login timed out, please retry')),
          Math.max(0, state.expiresAt - Date.now()),
        )
      })
      const payload = await Promise.race([state.callback, timeout])

      if (payload.query.error !== undefined) {
        throw CredentialError.providerError(
          `Zed authorization failed: ${payload.query.error_description ?? payload.query.error}`,
        )
      }
      const userId = normalizeNonEmpty(payload.query.user_id)
      const encryptedToken = normalizeNonEmpty(payload.query.access_token)
      if (!userId) throw CredentialError.invalidCredential('Zed callback missing user_id')
      if (!encryptedToken) throw CredentialError.invalidCredential('Zed callback missing access_token')

      const accessToken = this.decryptToken(state.privateKeyDer, encryptedToken)
      return buildZedMaterial(userId, accessToken)
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private decryptToken(privateKeyDer: Buffer, encryptedToken: string): string {
    const key = { key: privateKeyDer, format: 'der' as const, type: 'pkcs1' as const }
    const encrypted = decodeUrlSafeB64(encryptedToken)
    try {
      const decrypted = privateDecrypt(
        { ...key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        encrypted,
      )
      return decrypted.toString('utf8')
    } catch {
      try {
        const decrypted = privateDecrypt(
          { ...key, padding: cryptoConstants.RSA_PKCS1_PADDING },
          encrypted,
        )
        return decrypted.toString('utf8')
      } catch (e) {
        throw CredentialError.invalidCredential(
          `decrypt Zed access_token failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
  }
}

function buildZedMaterial(userId: string, accessToken: string): ImportedCredentialMaterial {
  const rawMetadata: JsonValue = {
    user_id: userId,
    access_token: accessToken,
  }
  return {
    provider: 'zed',
    email: userId,
    accessToken,
    refreshToken: undefined,
    expiresAt: undefined,
    source: 'oauth',
    rawMetadata,
  }
}
