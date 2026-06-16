// KiroAdapter 依赖的窄 port 接口 + 凭据/账号投影。
// 目的：把号小管现有基础设施（凭据库 retrieve / 账号库 findActive / 代理 resolver / token 刷新）
// 收敛成 4 个**只读窄接口**，KiroAdapter 只依赖这些接口而非具体 repo 类——
// 单测可用纯对象 stub，container 用现成实例适配（见 container.ts Task 4）。
import type { Dispatcher } from 'undici'

/** 解密后的 Kiro 凭据投影（KiroAdapter 仅需这 4 个字段）。 */
export interface KiroCredential {
  token: string
  refreshToken?: string
  expiresAt?: Date
  /** auth_method / profileArn / region / machineId 等指纹从此读（JsonValue 退化为 unknown，避免跨上下文耦合）。 */
  rawMetadata?: unknown
}

/** 选中账号的最小投影（M4 扩选择/健康所需字段）。 */
export interface KiroAccountInfo {
  id: string
  email: string
  /** 'Github'/'Google' → 社交 profile ARN 兜底；其余 → BuilderId（resolveProfileArn 用）。 */
  loginProvider?: string | undefined
  /** 可能含 profileArn/region/machineId（与凭据 rawMetadata 同优先级解析）。 */
  profilePayload?: unknown
  /** 'SUSPENDED' 等持久化健康状态；用于候选过滤。 */
  status?: string | undefined
  /** 账号是否激活（isActive=false 的账号不进候选池）。 */
  isActive: boolean
  /** epoch ms，用于 LRU 选择。 */
  lastUsedAt?: number | undefined
  /** 会员档位人类可读名（如 "KIRO PRO+"）。供「会员最高账号」选号取实时模型清单。 */
  planName?: string | undefined
  /** 会员档位内部码（如 Q_DEVELOPER_STANDALONE_PRO_PLUS）。 */
  planTier?: string | undefined
}

/** 凭据库窄 port：按账号取解密凭据。 */
export interface KiroCredentialPort {
  retrieve(accountId: string): Promise<KiroCredential | null>
}

/** 账号库窄 port（M4 池版）：枚举全池 + 风控挂起持久化读写。 */
export interface KiroAccountPort {
  listByPlatform(): Promise<KiroAccountInfo[]>
  markSuspended(id: string, reason: string): Promise<void>
  clearSuspension(id: string): Promise<void>
}

/** 代理 resolver 窄 port：账号 → undici Dispatcher（undefined=直连）。 */
export interface KiroDispatcherPort {
  dispatcherForAccount(accountId: string): Promise<Dispatcher | undefined>
}

/** token 刷新结果。 */
export interface RefreshedKiroToken {
  token: string
  refreshToken?: string
  expiresAt?: Date
}

/**
 * token 刷新结果（区分永久 vs 临时失败，供「401 刷不出新 token 则移出反代池」决策）：
 * - refreshed：拿到新 access token。
 * - permanent：永久失效（无 refreshToken / api_key 模式 / 缺 idc 凭据 / invalid_grant）→ 需移出反代池。
 * - transient：临时失败（刷新接口 429 / 网络 / 5xx）→ 仅冷却稍后重试，不移池。
 */
export type KiroRefreshOutcome =
  | ({ kind: 'refreshed' } & RefreshedKiroToken)
  | { kind: 'permanent' }
  | { kind: 'transient' }

/**
 * token 刷新窄 port：用旧凭据换新 access/refresh，并明确区分永久/临时失败。
 */
export interface KiroTokenRefresher {
  refresh(cred: KiroCredential, region: string): Promise<KiroRefreshOutcome>
}
