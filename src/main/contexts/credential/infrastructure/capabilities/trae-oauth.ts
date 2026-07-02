import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { hostname, platform as osPlatform } from 'node:os'
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
import { parseExpiresAt } from '../scan-helpers'
import { dispatcherFetch, normalizeNonEmpty, type OAuthFetch } from './oauth-http'

// Trae OAuth (loopback + PKCE + ECDSA device key + region failover). Ported from
// cockpit-tools modules/trae_oauth.rs:
//   1. GetLoginGuidance → loginHost (tries marscode/trae.ai/www.trae.ai),
//   2. bind ephemeral loopback (/authorize), open {loginHost}/authorization with
//      PKCE S256 + device/app context params,
//   3. callback carries either an authCode (→ ExchangeToken with an ECDSA P-256
//      DeviceInfo) or a refreshToken (→ ExchangeToken with ClientSecret "-"),
//   4. GetUserInfo (x-cloudide-token) → email/user_id/nickname.
// rawMetadata mirrors the trae profile derivation (trae_auth_raw/trae_profile_raw/
// trae_server_raw + user_id/email/nickname). Local Trae storage/log detection is
// omitted; a generated machine_id and default device context are used.

const LOGIN_GUIDANCE_URLS = [
  'https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance',
  'https://api.trae.ai/cloudide/api/v3/trae/GetLoginGuidance',
  'https://www.trae.ai/cloudide/api/v3/trae/GetLoginGuidance',
]
const AUTHORIZATION_PATH = '/authorization'
const CALLBACK_PATH = '/authorize'
const CLIENT_ID = 'ono9krqynydwx5'
const EXCHANGE_CLIENT_SECRET = '-'
const REFRESH_EXCHANGE_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'
const AUTHCODE_EXCHANGE_PATH = '/trae/api/v3/oauth/ExchangeToken'
const GET_USER_INFO_PATH = '/cloudide/api/v3/trae/GetUserInfo'
const MIN_AUTH_APP_VERSION = '3.5.54'
const DEFAULT_PLUGIN_VERSION = 'local'
const DEFAULT_DEVICE_ID = '0'
const DEFAULT_APP_TYPE = 'stable'
const ACCOUNT_API_ORIGIN_NORMAL = 'https://grow-normal.trae.ai'
const ACCOUNT_API_ORIGIN_SG = 'https://growsg-normal.trae.ai'
const ACCOUNT_API_ORIGIN_US = 'https://growsg-normal.trae.ai'
const ACCOUNT_API_ORIGIN_USTTP = 'https://grow-normal.traeapi.us'
const OAUTH_TIMEOUT_MS = 600_000

interface PendingTrae {
  server: LoopbackServer
  loginTraceId: string
  loginHost: string
  codeVerifier: string
  callback: Promise<CallbackPayload>
  expiresAt: number
}

interface DeviceKeyPair {
  privateKeyPem: string
  publicKeyPem: string
}

function pick(root: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    let current: unknown = root
    let ok = true
    for (const key of path) {
      if (current !== null && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[key]
      } else {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (typeof current === 'string' && current.trim().length > 0) return current.trim()
    if (typeof current === 'number') return String(current)
  }
  return undefined
}

function pickNum(root: unknown, paths: string[][]): number | undefined {
  const s = pick(root, paths)
  if (s === undefined) return undefined
  const n = Number.parseInt(s, 10)
  return Number.isNaN(n) ? undefined : n
}

function deviceType(): string {
  const p = osPlatform()
  if (p === 'darwin') return 'mac'
  if (p === 'win32') return 'windows'
  if (p === 'linux') return 'linux'
  return 'unknown'
}

function deviceBrand(type: string): string {
  if (type === 'mac') return 'Apple'
  if (type === 'windows') return 'Microsoft'
  if (type === 'linux') return 'Linux'
  return 'unknown'
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { privateKeyPem: privateKey as string, publicKeyPem: publicKey as string }
}

function inferLoginRegion(loginRegion: string | undefined, loginHost: string): string {
  const r = normalizeNonEmpty(loginRegion)
  if (r) return r.toLowerCase()
  const host = loginHost.toLowerCase()
  if (host.includes('.cn')) return 'cn'
  if (host.includes('.us')) return 'us'
  return 'sg'
}

function dedup(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (v.length === 0 || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function accountApiOrigins(region: string | undefined): string[] {
  const origins = [ACCOUNT_API_ORIGIN_NORMAL]
  switch (normalizeNonEmpty(region)?.toLowerCase()) {
    case 'usttp':
      origins.push(ACCOUNT_API_ORIGIN_USTTP)
      break
    case 'us':
      origins.push(ACCOUNT_API_ORIGIN_US)
      break
    case 'sg':
      origins.push(ACCOUNT_API_ORIGIN_SG)
      break
    default:
      break
  }
  origins.push(ACCOUNT_API_ORIGIN_SG, ACCOUNT_API_ORIGIN_US, ACCOUNT_API_ORIGIN_USTTP)
  return dedup(origins)
}

function apiOrigins(loginHost: string): string[] {
  const origins: string[] = []
  try {
    const url = new URL(loginHost.startsWith('http') ? loginHost : `https://${loginHost}`)
    origins.push(`${url.protocol}//${url.host}`)
    if (url.hostname.startsWith('www.')) {
      origins.push(`${url.protocol}//api.${url.hostname.slice(4)}`)
    }
  } catch {
    // ignore malformed host
  }
  origins.push(
    'https://api.marscode.com',
    'https://api.trae.ai',
    'https://www.trae.ai',
    'https://www.marscode.com',
  )
  return dedup(origins)
}

export class TraeOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingTrae>()
  private readonly transport: OAuthFetch
  private readonly guidanceUrls: string[]

  constructor(opts?: { transport?: OAuthFetch; guidanceUrls?: string[] }) {
    this.transport = opts?.transport ?? dispatcherFetch
    this.guidanceUrls = opts?.guidanceUrls ?? LOGIN_GUIDANCE_URLS
  }

  provider(): PlatformId {
    return 'trae'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('trae', 'oauth')
    }
    const loginTraceId = randomUUID()
    const loginHost = await this.requestLoginGuidance(loginTraceId)
    const { verifier, challenge } = generatePkce()

    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind([EPHEMERAL_PORT])
    } catch {
      throw CredentialError.oauthPortInUse(0)
    }
    const callbackUrl = `http://127.0.0.1:${boundPort}${CALLBACK_PATH}`
    const authorizeUrl = this.buildAuthorizeUrl(loginHost, loginTraceId, callbackUrl, challenge)
    const callback = server.registerPath(CALLBACK_PATH)

    const pendingId = randomUUID()
    this.pending.set(pendingId, {
      server,
      loginTraceId,
      loginHost,
      codeVerifier: verifier,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: CALLBACK_PATH,
      boundPort,
      state: loginTraceId,
      codeVerifier: verifier,
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
          () => reject(CredentialError.providerError('Trae login timed out, please retry')),
          Math.max(0, state.expiresAt - Date.now()),
        )
      })
      const payload = await Promise.race([state.callback, timeout])

      if (payload.query.error !== undefined) {
        throw CredentialError.providerError(
          `Trae authorization failed: ${payload.query.error_description ?? payload.query.error}`,
        )
      }
      const authCode = normalizeNonEmpty(
        payload.query.authCode ?? payload.query.auth_code ?? payload.query.code,
      )
      const refreshToken = normalizeNonEmpty(payload.query.refreshToken ?? payload.query.refresh_token)
      if (!authCode && !refreshToken) {
        throw CredentialError.invalidCredential('Trae callback missing authCode or refreshToken')
      }
      const loginHost = normalizeNonEmpty(payload.query.loginHost ?? payload.query.login_host) ?? state.loginHost
      const region = inferLoginRegion(payload.query.loginRegion ?? payload.query.login_region, loginHost)
      const cloudideToken = normalizeNonEmpty(payload.query.accessToken ?? payload.query['x-cloudide-token'])

      const exchange = authCode
        ? await this.exchangeByAuthCode(region, authCode, state.codeVerifier)
        : await this.exchangeByRefreshToken(loginHost, refreshToken!, cloudideToken)

      const accessToken = extractExchangeToken(exchange.response)
      if (!accessToken) {
        throw CredentialError.invalidCredential('Trae ExchangeToken response missing access token')
      }
      const nextRefresh =
        pick(exchange.response, [
          ['Result', 'RefreshToken'],
          ['result', 'refreshToken'],
          ['result', 'refresh_token'],
          ['refreshToken'],
          ['refresh_token'],
        ]) ?? refreshToken
      const tokenType = pick(exchange.response, [
        ['Result', 'TokenType'],
        ['result', 'tokenType'],
        ['tokenType'],
        ['token_type'],
      ])
      const expiresAtSec = pickNum(exchange.response, [
        ['Result', 'ExpiresAt'],
        ['Result', 'TokenExpireAt'],
        ['result', 'expiresAt'],
        ['expiresAt'],
        ['expires_at'],
      ])

      const userInfo = await this.getUserInfo(exchange.apiHost ?? loginHost, accessToken)
      const email =
        pick(userInfo, [
          ['Result', 'NonPlainTextEmail'],
          ['Result', 'Email'],
          ['result', 'email'],
          ['email'],
        ]) ?? 'trae-user'
      const userId = pick(userInfo, [
        ['Result', 'UserID'],
        ['result', 'userId'],
        ['result', 'uid'],
        ['userId'],
        ['uid'],
      ])
      const nickname = pick(userInfo, [
        ['Result', 'ScreenName'],
        ['Result', 'Nickname'],
        ['result', 'nickname'],
        ['result', 'name'],
        ['nickname'],
      ])

      const authRaw: Record<string, JsonValue> = {
        accessToken,
        loginHost,
        loginRegion: region,
        loginTraceID: state.loginTraceId,
        exchangeResponse: exchange.response as JsonValue,
      }
      if (nextRefresh) authRaw.refreshToken = nextRefresh
      if (exchange.apiHost) authRaw.apiHost = exchange.apiHost
      if (exchange.deviceInfo) authRaw.deviceInfo = exchange.deviceInfo
      if (exchange.deviceKeyPair) {
        authRaw.deviceKeyPair = {
          privateKeyPEM: exchange.deviceKeyPair.privateKeyPem,
          publicKeyPEM: exchange.deviceKeyPair.publicKeyPem,
        }
      }

      const rawMetadata: JsonValue = {
        email,
        user_id: userId ?? null,
        nickname: nickname ?? null,
        access_token: accessToken,
        refresh_token: nextRefresh ?? null,
        token_type: tokenType ?? null,
        trae_auth_raw: authRaw,
        trae_profile_raw: (userInfo ?? null) as JsonValue,
        trae_server_raw: {
          loginHost,
          loginRegion: region,
          loginTraceID: state.loginTraceId,
        },
      }

      return {
        provider: 'trae',
        email,
        accessToken,
        refreshToken: nextRefresh,
        expiresAt: expiresAtSec !== undefined ? parseExpiresAt(expiresAtSec) : undefined,
        source: 'oauth',
        rawMetadata,
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private async requestLoginGuidance(loginTraceId: string): Promise<string> {
    const errors: string[] = []
    for (const endpoint of this.guidanceUrls) {
      try {
        const resp = await this.transport(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Trae/1.0.0 haoxiaoguan',
          },
          body: JSON.stringify({ loginTraceID: loginTraceId, login_trace_id: loginTraceId }),
        })
        if (!resp.ok) {
          errors.push(`${endpoint} => HTTP ${resp.status}`)
          continue
        }
        const value = (await resp.json().catch(() => undefined)) as JsonValue
        const host = pick(value, [
          ['Result', 'LoginHost'],
          ['Result', 'loginHost'],
          ['Result', 'LoginURL'],
          ['result', 'loginHost'],
          ['result', 'loginUrl'],
          ['data', 'loginHost'],
          ['LoginHost'],
          ['loginHost'],
          ['loginUrl'],
        ])
        if (host) return host
        errors.push(`${endpoint} => missing LoginHost`)
      } catch (e) {
        errors.push(`${endpoint} => ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    throw CredentialError.providerError(`Trae GetLoginGuidance failed: ${errors.join(' | ')}`)
  }

  private buildAuthorizeUrl(
    loginHost: string,
    loginTraceId: string,
    callbackUrl: string,
    challenge: string,
  ): string {
    const base = loginHost.startsWith('http') ? loginHost : `https://${loginHost}`
    const url = new URL(base)
    url.pathname = AUTHORIZATION_PATH
    const deviceTypeValue = deviceType()
    const params = new URLSearchParams({
      login_version: '1',
      auth_from: 'trae',
      login_channel: 'native_ide',
      plugin_version: DEFAULT_PLUGIN_VERSION,
      auth_type: 'local',
      client_id: CLIENT_ID,
      redirect: '0',
      login_trace_id: loginTraceId,
      auth_callback_url: callbackUrl,
      machine_id: randomUUID(),
      device_id: DEFAULT_DEVICE_ID,
      x_device_id: DEFAULT_DEVICE_ID,
      x_device_type: deviceTypeValue,
      x_device_brand: deviceBrand(deviceTypeValue),
      x_os_version: deviceTypeValue,
      x_app_version: MIN_AUTH_APP_VERSION,
      x_app_type: DEFAULT_APP_TYPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    url.search = params.toString()
    return url.toString()
  }

  private async exchangeByAuthCode(
    region: string,
    authCode: string,
    codeVerifier: string,
  ): Promise<{ response: JsonValue; apiHost: string | undefined; deviceInfo: JsonValue; deviceKeyPair: DeviceKeyPair }> {
    const deviceKeyPair = generateDeviceKeyPair()
    const deviceInfo = this.buildDeviceInfo(deviceKeyPair.publicKeyPem)
    const errors: string[] = []
    for (const origin of accountApiOrigins(region)) {
      const url = `${origin}${AUTHCODE_EXCHANGE_PATH}`
      try {
        const resp = await this.transport(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-cloudide-token': '' },
          body: JSON.stringify({
            ClientID: CLIENT_ID,
            AuthCode: authCode,
            CodeVerifier: codeVerifier,
            DeviceInfo: deviceInfo,
            IDEVersion: MIN_AUTH_APP_VERSION,
          }),
        })
        if (!resp.ok) {
          errors.push(`${url} => HTTP ${resp.status}`)
          continue
        }
        const value = (await resp.json().catch(() => undefined)) as JsonValue
        if (extractExchangeToken(value)) {
          return { response: value, apiHost: origin, deviceInfo, deviceKeyPair }
        }
        errors.push(`${url} => missing access token`)
      } catch (e) {
        errors.push(`${url} => ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    throw CredentialError.providerError(`Trae AuthCode ExchangeToken failed: ${errors.join(' | ')}`)
  }

  private async exchangeByRefreshToken(
    loginHost: string,
    refreshToken: string,
    cloudideToken: string | undefined,
  ): Promise<{ response: JsonValue; apiHost: string | undefined; deviceInfo: JsonValue | undefined; deviceKeyPair: DeviceKeyPair | undefined }> {
    const errors: string[] = []
    for (const origin of apiOrigins(loginHost)) {
      const url = `${origin}${REFRESH_EXCHANGE_PATH}`
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
      if (cloudideToken) headers['x-cloudide-token'] = cloudideToken
      try {
        const resp = await this.transport(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ClientID: CLIENT_ID,
            RefreshToken: refreshToken,
            ClientSecret: EXCHANGE_CLIENT_SECRET,
            UserID: '',
          }),
        })
        if (!resp.ok) {
          errors.push(`${url} => HTTP ${resp.status}`)
          continue
        }
        const value = (await resp.json().catch(() => undefined)) as JsonValue
        if (extractExchangeToken(value)) {
          return { response: value, apiHost: undefined, deviceInfo: undefined, deviceKeyPair: undefined }
        }
        errors.push(`${url} => missing access token`)
      } catch (e) {
        errors.push(`${url} => ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    throw CredentialError.providerError(`Trae ExchangeToken failed: ${errors.join(' | ')}`)
  }

  private buildDeviceInfo(devicePublicKeyPem: string): JsonValue {
    const type = deviceType()
    return {
      DeviceID: DEFAULT_DEVICE_ID,
      MachineID: randomUUID(),
      PlatformCode: 'IDE_PC',
      DeviceType: 'PC',
      DeviceName: normalizeNonEmpty(hostname()) ?? 'PC',
      DeviceModel: deviceBrand(type),
      ClientVersion: MIN_AUTH_APP_VERSION,
      DevicePublicKey: devicePublicKeyPem,
      DeviceBrand: deviceBrand(type),
      DeviceCPU: '',
      OSInfo: type,
      OSVersion: type,
    }
  }

  private async getUserInfo(loginHost: string, accessToken: string): Promise<JsonValue | undefined> {
    for (const origin of apiOrigins(loginHost)) {
      try {
        const resp = await this.transport(`${origin}${GET_USER_INFO_PATH}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'x-cloudide-token': accessToken,
          },
          body: '{}',
        })
        if (!resp.ok) continue
        return (await resp.json().catch(() => undefined)) as JsonValue
      } catch {
        // try next origin
      }
    }
    return undefined
  }
}

function extractExchangeToken(value: JsonValue | undefined): string | undefined {
  return pick(value, [
    ['Result', 'AccessToken'],
    ['Result', 'accessToken'],
    ['Result', 'Token'],
    ['Result', 'token'],
    ['result', 'accessToken'],
    ['result', 'access_token'],
    ['result', 'token'],
    ['data', 'accessToken'],
    ['data', 'access_token'],
    ['Token'],
    ['accessToken'],
    ['access_token'],
    ['token'],
  ])
}
