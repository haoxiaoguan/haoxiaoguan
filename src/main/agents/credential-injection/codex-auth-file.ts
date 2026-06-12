import { join } from 'node:path'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { Credential } from '../../contexts/account/domain/credential'
import { homeDir, jwtPayload, pickString } from '../../contexts/credential/infrastructure/scan-helpers'

// Codex auth.json 构造（对照 cockpit-tools codex_account.rs::build_auth_file_value）。
// Codex 只认两种登录文件形态：
//   OAuth   → {"OPENAI_API_KEY": null, "tokens": {id_token, access_token,
//              refresh_token?, account_id?}, "last_refresh": "<UTC, 微秒>"}
//   API Key → {"auth_mode": "apikey", "OPENAI_API_KEY": "<key>"}
// 通用 {"token": ...} 注入格式写出来 Codex 不识别（会直接掉登录），codex 必须走这里。

const API_KEY_AUTH_MODE = 'apikey'

/** $CODEX_HOME 或 ~/.codex（与 codex-local-import 的扫描路径一致）。 */
export function codexHomeDir(): string {
  if (process.env.CODEX_HOME) return process.env.CODEX_HOME
  return join(homeDir(), '.codex')
}

export function codexAuthJsonPath(): string {
  return join(codexHomeDir(), 'auth.json')
}

function metadataObject(credential: Credential): Record<string, JsonValue> {
  const meta = credential.rawMetadata
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, JsonValue>)
    : {}
}

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3
}

/** 该凭据是否为 API Key 登录（auth_mode 优先；缺失时按形态启发）。 */
export function isCodexApiKeyCredential(credential: Credential): boolean {
  const meta = metadataObject(credential)
  const mode = typeof meta.auth_mode === 'string' ? meta.auth_mode.trim().toLowerCase() : undefined
  if (mode !== undefined && mode.length > 0) return mode === API_KEY_AUTH_MODE || mode === 'api_key'
  // 无 auth_mode 元数据：带 refresh/id_token 或 JWT 形态 → OAuth；sk- 前缀 → API Key。
  if (credential.refreshToken !== undefined || typeof meta.id_token === 'string') return false
  if (looksLikeJwt(credential.token)) return false
  return credential.token.startsWith('sk-')
}

/** Rust chrono 的 %Y-%m-%dT%H:%M:%S%.6fZ（6 位小数秒）。 */
function lastRefreshNow(): string {
  return new Date().toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')
}

function accountIdFromAccessToken(accessToken: string): string | undefined {
  const claims = jwtPayload(accessToken)
  return pickString(claims, [
    ['https://api.openai.com/auth', 'chatgpt_account_id'],
    ['https://api.openai.com/auth', 'account_id'],
    ['chatgpt_account_id'],
    ['account_id'],
  ])
}

/**
 * 由解密后的凭据组装 Codex 官方 auth.json 内容。
 * 凭据缺少必要材料（access_token / API key）时抛错，避免写出半残登录文件。
 */
export function buildCodexAuthFileValue(credential: Credential): Record<string, JsonValue> {
  const meta = metadataObject(credential)

  if (isCodexApiKeyCredential(credential)) {
    const apiKey = (typeof meta.api_key === 'string' && meta.api_key.trim().length > 0
      ? meta.api_key
      : credential.token
    ).trim()
    if (apiKey.length === 0) throw new Error('Codex API Key 账号缺少 OPENAI_API_KEY，无法写入 auth.json')
    return { auth_mode: API_KEY_AUTH_MODE, OPENAI_API_KEY: apiKey }
  }

  const accessToken = credential.token.trim()
  if (accessToken.length === 0) throw new Error('Codex OAuth 账号缺少 access_token，无法写入 auth.json')

  const idToken =
    pickString(meta, [['id_token'], ['tokens', 'id_token']]) ?? ''
  const refreshToken =
    credential.refreshToken ?? pickString(meta, [['refresh_token'], ['tokens', 'refresh_token']])
  const accountId =
    pickString(meta, [['account_id'], ['tokens', 'account_id'], ['chatgpt_account_id']]) ??
    accountIdFromAccessToken(accessToken)

  const tokens: Record<string, JsonValue> = { id_token: idToken, access_token: accessToken }
  if (refreshToken !== undefined && refreshToken.trim().length > 0) tokens.refresh_token = refreshToken
  if (accountId !== undefined) tokens.account_id = accountId

  return { OPENAI_API_KEY: null, tokens, last_refresh: lastRefreshNow() }
}
