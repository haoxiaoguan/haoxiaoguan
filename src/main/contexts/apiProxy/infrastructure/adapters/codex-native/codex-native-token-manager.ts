// 原生（ChatGPT OAuth）token 生命周期。
//
// 取舍（与「不碰 auth.json」硬约束一致）：
//   - 仅「读」~/.codex/auth.json 播种（access/refresh/account_id/id_token + last_refresh）。
//   - 之后号小管自管：刷新经 auth.openai.com/oauth/token，新 token 存自己的加密库
//     （SecretStore，appDataDir/secrets/）。全程**不写** auth.json。
//   - 中转注入开启时 Codex 不再直接用该 OAuth（其唯一 provider 指向反代），故号小管是该
//     token 的唯一使用者，刷新无竞争。
//   - 播种优先级：own 与 auth.json 取 last_refresh 更新者（用户重登 Codex 会让 auth 更新→重新播种；
//     会话内我们刷新过则 own 更新→沿用我们的，避免轮换后 auth 的旧 refresh_token 失效）。
//
// bytecode 安全：无 class-property 箭头初始化，纯方法。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homeDir, jwtPayload, pickString } from '../../../../../contexts/credential/infrastructure/scan-helpers'
import type { SecretStore } from '../../../../../contexts/sync/infrastructure/secret-store'

/** 默认 Codex OAuth client_id（取自官方 Codex 客户端）。 */
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
/** access_token 剩余有效期低于此阈值（秒）就提前刷新。 */
const REFRESH_SKEW_SEC = 60

/** 刷新所需的最小 HTTP 能力（RelayUpstreamClient 天然满足）。 */
export interface TokenRefreshHttp {
  post(
    url: string,
    headers: Record<string, string>,
    bodyJson: unknown,
  ): Promise<{ status: number; json(): Promise<unknown> }>
}

interface TokenState {
  accessToken: string
  refreshToken: string
  accountId: string
  /** 该份 token 的最近刷新时刻（epoch ms），用于 own/auth 播种择新。 */
  lastRefreshEpoch: number
}

export interface CodexNativeTokenManagerOpts {
  /** 号小管自管 token 的加密存储（一份文件一实例）。 */
  store: SecretStore
  /** 刷新用 HTTP 客户端（复用 RelayUpstreamClient）。 */
  http: TokenRefreshHttp
  /** auth.json 路径覆盖（测试）；默认 $CODEX_HOME 或 ~/.codex/auth.json。 */
  authJsonPath?: string
  /** 时钟（测试可注入）；默认 Date.now。 */
  clock?: () => number
  clientId?: string
}

/** 无 ChatGPT 登录可用（auth.json 缺失/无 tokens 且 own 库为空）。 */
export class CodexNativeNoLoginError extends Error {
  constructor(message = 'no ChatGPT login available for codex-native passthrough') {
    super(message)
    this.name = 'CodexNativeNoLoginError'
  }
}

export class CodexNativeTokenManager {
  private readonly store: SecretStore
  private readonly http: TokenRefreshHttp
  private readonly authJsonPath: string
  private readonly clock: () => number
  private readonly clientId: string
  private state: TokenState | null
  private loaded: boolean

  constructor(opts: CodexNativeTokenManagerOpts) {
    this.store = opts.store
    this.http = opts.http
    this.authJsonPath = opts.authJsonPath ?? defaultAuthJsonPath()
    this.clock = opts.clock ?? (() => Date.now())
    this.clientId = opts.clientId ?? CODEX_OAUTH_CLIENT_ID
    this.state = null
    this.loaded = false
  }

  /** auth.json 是否存在（容器据此决定是否注册原生上游）。 */
  static authPresent(authJsonPath?: string): boolean {
    return existsSync(authJsonPath ?? defaultAuthJsonPath())
  }

  /** 取一份有效 access_token + accountId；必要时刷新。无登录抛 CodexNativeNoLoginError。 */
  async ensureToken(): Promise<{ accessToken: string; accountId: string }> {
    if (!this.loaded) {
      await this.load()
      this.loaded = true
    }
    if (this.state === null) throw new CodexNativeNoLoginError()
    const exp = jwtExpSeconds(this.state.accessToken)
    const nowSec = Math.floor(this.clock() / 1000)
    if (exp !== undefined && exp - nowSec < REFRESH_SKEW_SEC) {
      await this.refresh()
    }
    return { accessToken: this.state.accessToken, accountId: this.state.accountId }
  }

  /** 强制刷新（上游 401 后重试一次用）。 */
  async forceRefresh(): Promise<{ accessToken: string; accountId: string }> {
    if (!this.loaded) {
      await this.load()
      this.loaded = true
    }
    if (this.state === null) throw new CodexNativeNoLoginError()
    await this.refresh()
    return { accessToken: this.state.accessToken, accountId: this.state.accountId }
  }

  /** 播种：own 库与 auth.json 取 last_refresh 更新者。 */
  private async load(): Promise<void> {
    const own = await this.readOwnStore()
    const auth = this.readAuthJson()
    if (own !== null && auth !== null) {
      this.state = own.lastRefreshEpoch >= auth.lastRefreshEpoch ? own : auth
    } else {
      this.state = own ?? auth
    }
  }

  private async readOwnStore(): Promise<TokenState | null> {
    try {
      const raw = await this.store.get()
      if (raw === null || raw.length === 0) return null
      const obj = JSON.parse(raw) as Partial<TokenState>
      if (typeof obj.accessToken === 'string' && typeof obj.refreshToken === 'string' && typeof obj.accountId === 'string') {
        return {
          accessToken: obj.accessToken,
          refreshToken: obj.refreshToken,
          accountId: obj.accountId,
          lastRefreshEpoch: typeof obj.lastRefreshEpoch === 'number' ? obj.lastRefreshEpoch : 0,
        }
      }
    } catch {
      /* own 库损坏 → 当作空，退 auth.json */
    }
    return null
  }

  private readAuthJson(): TokenState | null {
    try {
      if (!existsSync(this.authJsonPath)) return null
      const auth = JSON.parse(readFileSync(this.authJsonPath, 'utf8')) as Record<string, unknown>
      const tokens = (auth.tokens ?? {}) as Record<string, unknown>
      const accessToken = pickString(tokens, [['access_token'], ['accessToken']])
      const refreshToken = pickString(tokens, [['refresh_token'], ['refreshToken']])
      if (accessToken === undefined || refreshToken === undefined) return null
      const idToken = pickString(tokens, [['id_token'], ['idToken']])
      const accountId =
        pickString(tokens, [['account_id'], ['accountId']]) ??
        (idToken ? pickString(jwtPayload(idToken) ?? {}, [['https://api.openai.com/auth', 'chatgpt_account_id']]) : undefined) ??
        pickString(jwtPayload(accessToken) ?? {}, [['https://api.openai.com/auth', 'chatgpt_account_id']])
      if (accountId === undefined) return null
      const lastRefreshEpoch = parseIsoEpoch(auth.last_refresh)
      return { accessToken, refreshToken, accountId, lastRefreshEpoch }
    } catch {
      return null
    }
  }

  private async refresh(): Promise<void> {
    if (this.state === null) throw new CodexNativeNoLoginError()
    const resp = await this.http.post(
      OAUTH_TOKEN_URL,
      { 'Content-Type': 'application/json' },
      { client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.state.refreshToken },
    )
    const json = (await resp.json()) as Record<string, unknown>
    const accessToken = typeof json.access_token === 'string' ? json.access_token : undefined
    if (accessToken === undefined) {
      throw new Error('codex-native token refresh: response missing access_token')
    }
    const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : this.state.refreshToken
    const idToken = typeof json.id_token === 'string' ? json.id_token : undefined
    const accountId =
      (idToken ? pickString(jwtPayload(idToken) ?? {}, [['https://api.openai.com/auth', 'chatgpt_account_id']]) : undefined) ??
      this.state.accountId
    this.state = { accessToken, refreshToken, accountId, lastRefreshEpoch: this.clock() }
    await this.store.set(JSON.stringify(this.state))
  }
}

function defaultAuthJsonPath(): string {
  const codexHome = process.env.CODEX_HOME
  if (codexHome) return join(codexHome, 'auth.json')
  return join(homeDir(), '.codex', 'auth.json')
}

/** 取 JWT 的 exp（秒）；解析失败返回 undefined（视为不过期，按需在 401 时刷新）。 */
function jwtExpSeconds(token: string): number | undefined {
  const payload = jwtPayload(token)
  const exp = payload?.exp
  return typeof exp === 'number' ? exp : undefined
}

/** ISO 时间字符串 → epoch ms；无法解析返回 0。 */
function parseIsoEpoch(raw: unknown): number {
  if (typeof raw !== 'string') return 0
  const t = Date.parse(raw)
  return Number.isNaN(t) ? 0 : t
}
