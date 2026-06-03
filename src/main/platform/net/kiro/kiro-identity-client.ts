import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { createKiroTransport } from '../kiro-transport'
import { getMachineId } from '../../identity/machine-id'

// Context-neutral transport for Kiro (AWS CodeWhisperer) identity/usage calls.
// Mirrors the request shapes of the upstream Kiro IDE: region-routed endpoints,
// AWS-SDK-style User-Agent headers, and the IdC-vs-Social token-refresh split.
//
// Why a shared platform module: both the quota context (live usage refresh) and
// the credential context (import-time identity enrichment) need the exact same
// transport. Keeping it here — depending only on platform/net + platform/
// identity — avoids one bounded context importing another.
//
// Endpoints can be overridden for private/VPC enterprise deployments via
// HAOXIAOGUAN_KIRO_RUNTIME_ENDPOINT / HAOXIAOGUAN_KIRO_AUTH_ENDPOINT.

export const KIRO_IDE_VERSION = '0.11.107'
const AWS_SDK_OIDC_VERSION = '3.980.0'
// 对齐官方 AmazonQ 额度端点当前版本，需随上游跟进
const AWS_SDK_CWR_VERSION = '1.0.34'
// 聊天端点 IDE 版本（与 kiro-upstream-client 的 KIRO_CHAT_IDE_VERSION 对齐）。
const KIRO_MODELS_IDE_VERSION = '0.12.155'
const DEFAULT_REGION = 'us-east-1'
const HTTP_TIMEOUT_MS = 25_000
const MODEL_LIST_TTL_MS = 5 * 60 * 1000 // 5 分钟

const RUNTIME_ENDPOINT_OVERRIDE = process.env.HAOXIAOGUAN_KIRO_RUNTIME_ENDPOINT
const AUTH_ENDPOINT_OVERRIDE = process.env.HAOXIAOGUAN_KIRO_AUTH_ENDPOINT

export type KiroAuthMethod = 'idc' | 'social' | 'api_key'

/** Injectable fetch (defaults to undici + ambient proxy dispatcher + timeout). */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

export interface KiroTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  profileArn?: string
}

export type KiroRefreshInput =
  | { kind: 'idc'; clientId: string; clientSecret: string; refreshToken: string; region: string }
  | { kind: 'social'; refreshToken: string; region: string }

export interface KiroUsageLimitsInput {
  accessToken: string
  authMethod: KiroAuthMethod
  region: string
  profileArn?: string
}

/**
 * Raised when the upstream signals the refresh token is permanently invalid
 * (400 + invalid_grant). Callers MUST NOT retry — the credential needs re-auth.
 */
export class KiroAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'KiroAuthError'
    Object.setPrototypeOf(this, KiroAuthError.prototype)
  }
}

class KiroHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'KiroHttpError'
    Object.setPrototypeOf(this, KiroHttpError.prototype)
  }
}

// --- auth-method resolution ---

/** Classify a credential's auth flow from its rawMetadata. */
export function resolveKiroAuthMethod(rawMetadata: unknown): KiroAuthMethod {
  const meta = isObject(rawMetadata) ? rawMetadata : {}
  const explicit = pickStr(meta, ['auth_method', 'authMethod'])?.toLowerCase()
  if (explicit === 'idc' || explicit === 'iam' || explicit === 'builder-id') return 'idc'
  if (explicit === 'api_key' || explicit === 'apikey') return 'api_key'
  if (explicit === 'social' || explicit === 'builderid') return 'social'
  if (pickStr(meta, ['kiroApiKey', 'kiro_api_key', 'apiKey']) !== undefined) return 'api_key'
  // Some accounts carry a `provider` field: Github/Google are social logins;
  // BuilderId/Enterprise are AWS SSO (IdC). Honor it before the pair heuristic.
  const provider = pickStr(meta, ['provider'])?.toLowerCase()
  if (provider === 'github' || provider === 'google') return 'social'
  if (provider === 'builderid' || provider === 'enterprise' || provider === 'idc') return 'idc'
  const hasIdcPair =
    pickStr(meta, ['client_id', 'clientId']) !== undefined &&
    pickStr(meta, ['client_secret', 'clientSecret']) !== undefined
  return hasIdcPair ? 'idc' : 'social'
}

// --- profileArn defaults ---

// Well-known CodeWhisperer profile ARNs the Kiro IDE uses when an account has no
// explicit profileArn (e.g. a social/Builder-ID device login): social logins
// resolve to the social profile, everything else to the Builder-ID profile.
// Without one, getUsageLimits
// still works for some accounts but Enterprise/runtime routing expects it, so we
// supply the canonical default rather than omitting it.
export const KIRO_SOCIAL_PROFILE_ARN =
  'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK'
export const KIRO_BUILDER_ID_PROFILE_ARN =
  'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX'

/** Default profileArn for an account that carries none, keyed by auth method. */
export function defaultProfileArnFor(authMethod: KiroAuthMethod): string {
  return authMethod === 'social' ? KIRO_SOCIAL_PROFILE_ARN : KIRO_BUILDER_ID_PROFILE_ARN
}

// --- region → endpoint ---

export function parseRegionFromArn(profileArn: string | undefined): string | undefined {
  if (profileArn === undefined) return undefined
  const segments = profileArn.split(':')
  if (segments[0]?.trim().toLowerCase() !== 'arn') return undefined
  const region = segments[3]?.trim()
  return region !== undefined && region.length > 0 ? region : undefined
}

export function normalizeRegion(region: string | undefined): string {
  const r = region?.trim().toLowerCase()
  return r !== undefined && r.length > 0 ? r : DEFAULT_REGION
}

/** Runtime (q.<region>.amazonaws.com) endpoint for getUsageLimits / API calls. */
export function runtimeEndpointForRegion(region: string): string {
  if (RUNTIME_ENDPOINT_OVERRIDE !== undefined && RUNTIME_ENDPOINT_OVERRIDE.trim().length > 0) {
    return RUNTIME_ENDPOINT_OVERRIDE.trim()
  }
  switch (region) {
    case 'us-east-1':
      return 'https://q.us-east-1.amazonaws.com'
    case 'eu-central-1':
      return 'https://q.eu-central-1.amazonaws.com'
    case 'us-gov-east-1':
      return 'https://q-fips.us-gov-east-1.amazonaws.com'
    case 'us-gov-west-1':
      return 'https://q-fips.us-gov-west-1.amazonaws.com'
    case 'us-iso-east-1':
      return 'https://q.us-iso-east-1.c2s.ic.gov'
    case 'us-isob-east-1':
      return 'https://q.us-isob-east-1.sc2s.sgov.gov'
    case 'us-isof-south-1':
      return 'https://q.us-isof-south-1.csp.hci.ic.gov'
    case 'us-isof-east-1':
      return 'https://q.us-isof-east-1.csp.hci.ic.gov'
    default:
      return 'https://q.us-east-1.amazonaws.com'
  }
}

/** Social (Builder ID) refresh endpoint: prod.<region>.auth.desktop.kiro.dev. */
function socialAuthEndpointForRegion(region: string): string {
  if (AUTH_ENDPOINT_OVERRIDE !== undefined && AUTH_ENDPOINT_OVERRIDE.trim().length > 0) {
    return AUTH_ENDPOINT_OVERRIDE.trim()
  }
  const known = new Set(['us-east-1', 'eu-central-1', 'us-gov-east-1', 'us-gov-west-1'])
  const r = known.has(region) ? region : DEFAULT_REGION
  return `https://prod.${r}.auth.desktop.kiro.dev`
}

/** IdC (Enterprise) refresh endpoint: AWS SSO OIDC oidc.<region>.amazonaws.com. */
function idcOidcEndpointForRegion(region: string): string {
  if (AUTH_ENDPOINT_OVERRIDE !== undefined && AUTH_ENDPOINT_OVERRIDE.trim().length > 0) {
    return AUTH_ENDPOINT_OVERRIDE.trim()
  }
  return `https://oidc.${region}.amazonaws.com`
}

// --- User-Agent headers ---

function osToken(): string {
  // e.g. "darwin#24.6.0" / "win32#10.0.22631"
  return `${process.platform}#${release()}`
}

function nodeVersion(): string {
  return process.versions.node
}

function idcRefreshHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-amz-user-agent': `aws-sdk-js/${AWS_SDK_OIDC_VERSION} KiroIDE`,
    'user-agent': `aws-sdk-js/${AWS_SDK_OIDC_VERSION} ua/2.1 os/${osToken()} lang/js md/nodejs#${nodeVersion()} api/sso-oidc#${AWS_SDK_OIDC_VERSION} m/E KiroIDE`,
    'amz-sdk-invocation-id': randomUUID(),
    'amz-sdk-request': 'attempt=1; max=4',
  }
}

function socialRefreshHeaders(): Record<string, string> {
  const ua = `KiroIDE-${KIRO_IDE_VERSION}-${getMachineId()}`
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': ua,
  }
}

function usageLimitsHeaders(input: KiroUsageLimitsInput): Record<string, string> {
  const mid = getMachineId()
  const headers: Record<string, string> = {
    'x-amz-user-agent': `aws-sdk-js/${AWS_SDK_CWR_VERSION} KiroIDE-${KIRO_IDE_VERSION}-${mid}`,
    'user-agent': `aws-sdk-js/${AWS_SDK_CWR_VERSION} ua/2.1 os/${osToken()} lang/js md/nodejs#${nodeVersion()} api/codewhispererruntime#${AWS_SDK_CWR_VERSION} m/E KiroIDE-${KIRO_IDE_VERSION}-${mid}`,
    'amz-sdk-invocation-id': randomUUID(),
    'amz-sdk-request': 'attempt=1; max=1',
    Authorization: `Bearer ${input.accessToken.trim()}`,
  }
  if (input.authMethod === 'api_key') headers.tokentype = 'API_KEY'
  return headers
}

// --- requests ---

/**
 * Refresh a Kiro token. IdC posts to AWS SSO OIDC (clientId+clientSecret); Social
 * posts to the Kiro desktop auth service. A 400 invalid_grant throws a permanent
 * KiroAuthError so callers disable rather than retry.
 */
export async function refreshKiroToken(
  input: KiroRefreshInput,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<KiroTokenResponse> {
  const region = normalizeRegion(input.region)
  const doFetch = opts.fetchImpl ?? defaultFetch
  let url: string
  let headers: Record<string, string>
  let body: string
  if (input.kind === 'idc') {
    url = `${idcOidcEndpointForRegion(region).replace(/\/+$/, '')}/token`
    headers = idcRefreshHeaders()
    body = JSON.stringify({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      refreshToken: input.refreshToken,
      grantType: 'refresh_token',
    })
  } else {
    url = `${socialAuthEndpointForRegion(region).replace(/\/+$/, '')}/refreshToken`
    headers = socialRefreshHeaders()
    body = JSON.stringify({ refreshToken: input.refreshToken })
  }

  const response = await doFetch(url, { method: 'POST', headers, body })
  const text = await response.text()
  if (!response.ok) {
    if (response.status === 400 && /invalid_grant/i.test(text)) {
      throw new KiroAuthError(
        `Kiro ${input.kind} refreshToken 已失效 (invalid_grant)`,
        'invalid_grant',
        true,
      )
    }
    throw new KiroHttpError(`Kiro refreshToken 返回异常: status=${response.status}`, response.status, text)
  }
  const parsed = safeJson(text)
  const data = isObject(parsed) && isObject(parsed.data) ? parsed.data : parsed
  const obj = isObject(data) ? data : {}
  const accessToken = pickStr(obj, ['accessToken', 'access_token', 'token', 'idToken', 'id_token'])
  if (accessToken === undefined) {
    throw new KiroHttpError('Kiro refreshToken 响应缺少 accessToken', response.status, text)
  }
  return {
    accessToken,
    refreshToken: pickStr(obj, ['refreshToken', 'refresh_token', 'refreshTokenJwt']),
    expiresAt: parseExpiry(obj),
    profileArn: pickStr(obj, ['profileArn', 'profile_arn']),
  }
}

/** GET getUsageLimits. Returns the parsed JSON body (raw usage payload). */
export async function fetchKiroUsageLimits(
  input: KiroUsageLimitsInput,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<unknown> {
  const region = normalizeRegion(input.region)
  const doFetch = opts.fetchImpl ?? defaultFetch
  const base = runtimeEndpointForRegion(region).replace(/\/+$/, '')
  // Fall back to the well-known per-auth-method profile when the account carries
  // none (social/device logins typically don't). Mirrors the reference.
  const profileArn = input.profileArn ?? defaultProfileArnFor(input.authMethod)
  const profilePart = `&profileArn=${encodeURIComponent(profileArn)}`
  const url = `${base}/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&isEmailRequired=true${profilePart}`
  const response = await doFetch(url, { method: 'GET', headers: usageLimitsHeaders(input) })
  const text = await response.text()
  if (!response.ok) {
    throw new KiroHttpError(`Kiro getUsageLimits 返回异常: status=${response.status}`, response.status, text)
  }
  return safeJson(text)
}

// --- default transport（统一 kiro-transport：undici + ambient proxy dispatcher + 短期 TLS 调整 + 超时）---
//
// 与 kiro-upstream-client 共用同一底层实现（createKiroTransport），消除两份重复的 undici+dispatcher 逻辑。
// 刷新/额度/模型路径（refreshKiroToken / fetchKiroUsageLimits / fetchAvailableModels）均经此 transport 出站，
// 保证全出站 JA3 降级覆盖（聊天路径经 kiro-upstream-client 的 defaultKiroFetch → 同一 kiroTransport）。
//
// 注：timeout 由 controller 在此层管理；底层 transport 不重复设超时（dispatcher 已带 TLS 选项）。
const identityKiroTransport = createKiroTransport()

async function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    return await identityKiroTransport.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// --- ListAvailableModels ---

/** 单条模型信息（id 必填，其余字段透传上游可选字段）。 */
export interface KiroModelInfo {
  modelId: string
  modelName?: string
  tokenLimits?: unknown
  promptCaching?: unknown
  rateMultiplier?: number
  availableOrigins?: unknown
}

export interface FetchAvailableModelsInput {
  accessToken: string
  region: string
  profileArn?: string
  machineId: string
}

/**
 * 调用 ListAvailableModels 端点获取当前账号可用模型列表（含分页聚合）。
 * 失败时返回空数组，让上层回退静态列表，不崩进程。
 */
export async function fetchAvailableModels(
  input: FetchAvailableModelsInput,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<KiroModelInfo[]> {
  const region = normalizeRegion(input.region)
  const doFetch = opts.fetchImpl ?? defaultFetch
  const base = runtimeEndpointForRegion(region).replace(/\/+$/, '')
  const profilePart =
    input.profileArn !== undefined && input.profileArn.trim().length > 0
      ? `&profileArn=${encodeURIComponent(input.profileArn.trim())}`
      : ''
  const headers = availableModelsHeaders(input)

  const models: KiroModelInfo[] = []
  let nextToken: string | undefined

  try {
    do {
      const tokenPart = nextToken !== undefined ? `&nextToken=${encodeURIComponent(nextToken)}` : ''
      const url = `${base}/ListAvailableModels?origin=AI_EDITOR&maxResults=50${profilePart}${tokenPart}`
      const response = await doFetch(url, { method: 'GET', headers })
      const text = await response.text()
      if (!response.ok) {
        // 授权错误或服务错误：返回已聚合的部分（首页通常为空），不抛
        return models
      }
      const parsed = safeJson(text)
      if (!isObject(parsed)) return models
      const rawModels = parsed.models
      if (Array.isArray(rawModels)) {
        for (const m of rawModels) {
          if (!isObject(m)) continue
          const modelId = pickStr(m, ['modelId'])
          if (modelId === undefined) continue
          const info: KiroModelInfo = { modelId }
          const modelName = pickStr(m, ['modelName'])
          if (modelName !== undefined) info.modelName = modelName
          if ('tokenLimits' in m) info.tokenLimits = m.tokenLimits
          if ('promptCaching' in m) info.promptCaching = m.promptCaching
          if (typeof m.rateMultiplier === 'number') info.rateMultiplier = m.rateMultiplier
          if ('availableOrigins' in m) info.availableOrigins = m.availableOrigins
          models.push(info)
        }
      }
      const nt = pickStr(parsed, ['nextToken'])
      nextToken = nt
    } while (nextToken !== undefined)
  } catch {
    // 网络异常等：返回已聚合部分（通常为空）
    return models
  }

  return models
}

function availableModelsHeaders(input: FetchAvailableModelsInput): Record<string, string> {
  const mid = input.machineId
  const dashSuffix = `KiroIDE-${KIRO_MODELS_IDE_VERSION}-${mid}`
  return {
    Authorization: `Bearer ${input.accessToken.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-amzn-codewhisperer-optout': 'true',
    'x-amz-user-agent': `aws-sdk-js/${AWS_SDK_CWR_VERSION} ua/2.1 os/${osToken()} lang/js md/nodejs#${nodeVersion()} api/codewhispererstreaming#${AWS_SDK_CWR_VERSION} ${dashSuffix}`,
    'user-agent': `aws-sdk-js/${AWS_SDK_CWR_VERSION} ua/2.1 os/${osToken()} lang/js md/nodejs#${nodeVersion()} api/codewhispererstreaming#${AWS_SDK_CWR_VERSION} m/E ${dashSuffix}`,
    'amz-sdk-invocation-id': randomUUID(),
    'amz-sdk-request': 'attempt=1; max=1',
  }
}

// --- 进程级模型列表缓存 ---

export type ClockFn = () => number

interface ModelListCacheEntry {
  models: KiroModelInfo[]
  fetchedAt: number
}

/**
 * 进程级 Map 缓存：key = `accountId:region:profileArn`，TTL 5 分钟。
 * 注入 clock 便于单测覆盖过期逻辑。
 */
export class ModelListCache {
  private readonly cache = new Map<string, ModelListCacheEntry>()
  private readonly ttlMs: number
  private readonly clock: ClockFn

  constructor(opts: { ttlMs?: number; clock?: ClockFn } = {}) {
    this.ttlMs = opts.ttlMs ?? MODEL_LIST_TTL_MS
    this.clock = opts.clock ?? Date.now
  }

  /** 命中未过期缓存直接返回；否则调用 fetcher 刷新并缓存。 */
  async getOrFetch(key: string, fetcher: () => Promise<KiroModelInfo[]>): Promise<KiroModelInfo[]> {
    const now = this.clock()
    const entry = this.cache.get(key)
    if (entry !== undefined && now - entry.fetchedAt < this.ttlMs) {
      return entry.models
    }
    const models = await fetcher()
    this.cache.set(key, { models, fetchedAt: this.clock() })
    return models
  }

  /** 主动使 key 的缓存失效（账号切换、手动刷新等场景）。 */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /** 构建标准 key：accountId:region:profileArn（profileArn 可空）。 */
  static makeKey(accountId: string, region: string, profileArn: string | undefined): string {
    return `${accountId}:${region}:${profileArn ?? ''}`
  }
}

// --- helpers ---

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseExpiry(obj: Record<string, unknown>): Date | undefined {
  const ts = obj.expiresAt ?? obj.expires_at ?? obj.expiry ?? obj.expiration
  if (typeof ts === 'number') {
    const seconds = ts > 10_000_000_000 ? Math.floor(ts / 1000) : ts
    return seconds > 0 ? new Date(seconds * 1000) : undefined
  }
  if (typeof ts === 'string') {
    const ms = Date.parse(ts)
    if (!Number.isNaN(ms)) return new Date(ms)
  }
  const expiresIn = obj.expiresIn ?? obj.expires_in
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000)
  }
  return undefined
}
