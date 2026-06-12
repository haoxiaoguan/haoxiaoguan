import type { JsonValue } from '../domain/platform-account-profile'
import { Credential } from '../domain/credential'
import type { CredentialRefresher } from '../domain/ports'
import { httpFetch, jwtNeedsRefresh, parseJson } from '../../quota/infrastructure/http/common'
import { isCodexApiKeyCredential } from '../../../agents/credential-injection/codex-auth-file'

// Codex OAuth 凭据切换前刷新（对照 cockpit-tools refresh_managed_account_locked：
// 切换前过期 token 必须先换新，否则写出去的登录立刻 401）。端点与 client_id 与
// quota/http/codex.ts 的刷新一致；HTTP 可注入便于单测。
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export type TokenRefreshFn = (refreshToken: string) => Promise<JsonValue>

async function refreshViaOpenAI(refreshToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    },
    'Codex Token 刷新请求失败',
  )
  if (!response.ok) throw new Error(`Codex Token 刷新失败: status=${response.status}`)
  return parseJson(response, '解析 Codex Token 响应失败')
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

function str(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export class CodexCredentialRefresher implements CredentialRefresher {
  private readonly refreshFn: TokenRefreshFn

  constructor(refreshFn: TokenRefreshFn = refreshViaOpenAI) {
    this.refreshFn = refreshFn
  }

  async refreshIfNeeded(credential: Credential): Promise<Credential> {
    // API Key 不会过期，不刷新；无 refresh_token 也无从刷新（交由上层的过期校验）。
    if (isCodexApiKeyCredential(credential)) return credential
    if (!jwtNeedsRefresh(credential.token)) return credential
    const refreshToken = credential.refreshToken?.trim()
    if (refreshToken === undefined || refreshToken.length === 0) return credential

    const resp = asObject(await this.refreshFn(refreshToken)) ?? {}
    const accessToken = str(resp.access_token)
    if (accessToken === undefined) {
      throw new Error('Codex Token 刷新响应缺少 access_token')
    }
    const nextRefreshToken = str(resp.refresh_token) ?? refreshToken
    const idToken = str(resp.id_token)
    const expiresAt =
      typeof resp.expires_in === 'number' ? new Date(Date.now() + resp.expires_in * 1000) : undefined

    // 同步更新 rawMetadata（auth.json 组装从这里取 id_token/account_id），
    // 顶层与嵌套 tokens 两处都换新，避免留下旧 token 残影。
    const meta = { ...(asObject(credential.rawMetadata) ?? {}) }
    meta.access_token = accessToken
    meta.refresh_token = nextRefreshToken
    if (idToken !== undefined) meta.id_token = idToken
    if (expiresAt !== undefined) meta.expires_at = Math.floor(expiresAt.getTime() / 1000)
    const nestedTokens = asObject(meta.tokens)
    if (nestedTokens !== undefined) {
      const next: Record<string, JsonValue> = {
        ...nestedTokens,
        access_token: accessToken,
        refresh_token: nextRefreshToken,
      }
      if (idToken !== undefined) next.id_token = idToken
      meta.tokens = next
    }

    return new Credential(accessToken, nextRefreshToken, expiresAt, meta)
  }
}
