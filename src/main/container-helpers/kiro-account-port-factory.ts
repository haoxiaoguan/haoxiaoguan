// KiroAccountPort factory — 把账号仓库适配成 KiroAccountPort（窄 port 版）。
// 从 container 抽出便于独立单测（测试注入内存 stub）；container 改为调 makeKiroAccountPort(accountRepo)。
import type { KiroAccountPort, KiroAccountInfo } from '../contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'

// 最小仓库接口（避免耦合具体 domain 类；container 传 AccountRepository，测试传内存 stub）。
// findByPlatform 固定传 'kiro'；findById/save 用于 markSuspended/clearSuspension。
interface AccountRow {
  id: string
  email: string
  loginProvider?: string | null
  profilePayload?: unknown
  status?: string | null
  statusReason?: string | null
  isActive: boolean
  lastUsedAt?: Date | string | null
  planName?: string | null
  planTier?: string | null
  // Account domain 对象可能有 updateProfilePayload 方法（优先调用以保持 domain 不变式）。
  updateProfilePayload?: (patch: unknown) => void
}

interface AccountRepoLike {
  findByPlatform(platform: string): Promise<AccountRow[]>
  findById(id: string): Promise<AccountRow | null>
  save(acc: AccountRow): Promise<void>
}

/** lastUsedAt 兼容 Date 对象（domain）或 RFC3339 字符串（stub/entity 层）两种形态 → epoch ms。 */
function toEpochMs(val?: Date | string | null): number | undefined {
  if (val === undefined || val === null) return undefined
  if (val instanceof Date) return val.getTime()
  const t = Date.parse(val)
  return Number.isNaN(t) ? undefined : t
}

/**
 * 把账号仓库适配为 KiroAccountPort（M4 池版三方法）。
 * - listByPlatform：findByPlatform('kiro') → KiroAccountInfo[]。
 * - markSuspended：findById → 写 status/statusReason → save。
 * - clearSuspension：findById → 清 status/statusReason → save。
 *
 * 若 acc 有 updateProfilePayload（Account domain 对象），优先调用保持不变式；
 * 否则直接赋值（内存 stub / plain object 兼容路径）。
 */
export function makeKiroAccountPort(accountRepo: AccountRepoLike): KiroAccountPort {
  return {
    async listByPlatform(): Promise<KiroAccountInfo[]> {
      const accounts = await accountRepo.findByPlatform('kiro')
      return accounts.map((acc) => ({
        id: acc.id,
        email: acc.email,
        ...(acc.loginProvider !== undefined && acc.loginProvider !== null ? { loginProvider: acc.loginProvider } : {}),
        ...(acc.profilePayload !== undefined ? { profilePayload: acc.profilePayload } : {}),
        ...(acc.status !== undefined && acc.status !== null ? { status: acc.status } : {}),
        isActive: acc.isActive,
        ...(toEpochMs(acc.lastUsedAt) !== undefined ? { lastUsedAt: toEpochMs(acc.lastUsedAt) } : {}),
        ...(acc.planName !== undefined && acc.planName !== null ? { planName: acc.planName } : {}),
        ...(acc.planTier !== undefined && acc.planTier !== null ? { planTier: acc.planTier } : {}),
      }))
    },

    async markSuspended(id: string, reason: string): Promise<void> {
      const acc = await accountRepo.findById(id)
      if (acc === null) return
      if (typeof acc.updateProfilePayload === 'function') {
        acc.updateProfilePayload({ status: 'SUSPENDED', statusReason: reason })
      } else {
        acc.status = 'SUSPENDED'
        acc.statusReason = reason
      }
      await accountRepo.save(acc)
    },

    async clearSuspension(id: string): Promise<void> {
      const acc = await accountRepo.findById(id)
      if (acc === null) return
      if (typeof acc.updateProfilePayload === 'function') {
        acc.updateProfilePayload({ status: null, statusReason: null })
      } else {
        acc.status = null
        acc.statusReason = null
      }
      await accountRepo.save(acc)
    },
  }
}
