// Cursor token refresher — 用 cursor 的 OAuth 刷新端点换新 access token（我们相对 9router 的净增强：
// 9router 压根不刷新）。实现 KiroTokenRefresher 同形接口，供 CursorUpstreamClient 的 401/403 重试。
// 出站经统一 transport（读 ambient dispatcher，跟随账号代理）。
import type {
  KiroTokenRefresher,
  KiroCredential,
  KiroRefreshOutcome,
} from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import { createKiroTransport } from '../platform/net/kiro-transport'

const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token'
// 对齐我们 quota/infrastructure/http/cursor.ts 已用的 cursor client id。
const CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'

const PERMANENT: KiroRefreshOutcome = { kind: 'permanent' }
const TRANSIENT: KiroRefreshOutcome = { kind: 'transient' }

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

export function createCursorTokenRefresher(): KiroTokenRefresher {
  const transport = createKiroTransport()
  return {
    async refresh(cred: KiroCredential): Promise<KiroRefreshOutcome> {
      const refresh = cred.refreshToken
      if (refresh === undefined || refresh.trim().length === 0) return PERMANENT // 无 refreshToken → 永久刷不出
      try {
        const init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh }),
        } as unknown as RequestInit
        const resp = await transport.fetch(OAUTH_TOKEN_URL, init)
        if (!resp.ok) return TRANSIENT // 429/网络/5xx → 临时（冷却重试，不移池）
        const json = (await resp.json()) as Record<string, unknown>
        const token = pickString(json, ['accessToken', 'access_token'])
        if (token === undefined) return TRANSIENT
        const newRefresh = pickString(json, ['refreshToken', 'refresh_token'])
        return { kind: 'refreshed', token, ...(newRefresh !== undefined ? { refreshToken: newRefresh } : {}) }
      } catch {
        return TRANSIENT
      }
    },
  }
}
