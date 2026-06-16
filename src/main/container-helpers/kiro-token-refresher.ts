// Kiro token refresher — 从 container 抽出（自包含，仅依赖 kiro-identity-client
// 纯函数，便于独立单测）。按 auth-method（social/idc/api_key）刷新 Kiro OAuth
// token；region 传入优先，否则按 profileArn 段兜底（与额度路径一致）。
import type {
  KiroTokenRefresher,
  KiroCredential,
  KiroRefreshOutcome,
} from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import {
  refreshKiroToken,
  resolveKiroAuthMethod,
  normalizeRegion,
  parseRegionFromArn,
  defaultProfileArnFor,
} from '../platform/net/kiro/kiro-identity-client'

const PERMANENT: KiroRefreshOutcome = { kind: 'permanent' }
const TRANSIENT: KiroRefreshOutcome = { kind: 'transient' }

/** refreshKiroToken 抛错时分类：invalid_grant（permanent=true）→ 永久；其余（429/网络/5xx）→ 临时。 */
function classifyRefreshError(e: unknown): KiroRefreshOutcome {
  const err = e as { name?: string; permanent?: boolean } | null
  if (err?.name === 'KiroAuthError' && err.permanent === true) return PERMANENT
  return TRANSIENT
}

export function createKiroTokenRefresher(): KiroTokenRefresher {
  return {
    async refresh(cred: KiroCredential, region: string): Promise<KiroRefreshOutcome> {
      const refresh = cred.refreshToken
      if (refresh === undefined || refresh.trim().length === 0) return PERMANENT // 无 refreshToken：永久刷不出
      const authMethod = resolveKiroAuthMethod(cred.rawMetadata)
      if (authMethod === 'api_key') return PERMANENT // api_key 模式不刷新 → 永久
      // region：传入优先，否则按 profileArn 段兜底（与额度路径一致）。
      const meta = (cred.rawMetadata ?? {}) as Record<string, unknown>
      const profileArn =
        typeof meta.profileArn === 'string'
          ? meta.profileArn
          : typeof meta.profile_arn === 'string'
            ? (meta.profile_arn as string)
            : defaultProfileArnFor(authMethod)
      const useRegion = normalizeRegion(region || parseRegionFromArn(profileArn))
      try {
        if (authMethod === 'idc') {
          const clientId = typeof meta.client_id === 'string' ? meta.client_id : (meta.clientId as string | undefined)
          const clientSecret =
            typeof meta.client_secret === 'string' ? meta.client_secret : (meta.clientSecret as string | undefined)
          if (clientId === undefined || clientSecret === undefined) return PERMANENT // 缺 idc 凭据 → 永久
          const out = await refreshKiroToken({ kind: 'idc', clientId, clientSecret, refreshToken: refresh, region: useRegion })
          return { kind: 'refreshed', token: out.accessToken, ...(out.refreshToken ? { refreshToken: out.refreshToken } : {}), ...(out.expiresAt ? { expiresAt: out.expiresAt } : {}) }
        }
        const out = await refreshKiroToken({ kind: 'social', refreshToken: refresh, region: useRegion })
        return { kind: 'refreshed', token: out.accessToken, ...(out.refreshToken ? { refreshToken: out.refreshToken } : {}), ...(out.expiresAt ? { expiresAt: out.expiresAt } : {}) }
      } catch (e) {
        // invalid_grant → 永久失效（移池）；429/网络/5xx → 临时（冷却重试，不移池）。
        return classifyRefreshError(e)
      }
    },
  }
}
