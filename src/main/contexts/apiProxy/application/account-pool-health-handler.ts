import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'

export interface AccountPoolHealthRow {
  accountId: string
  email: string
  status?: string
  runtimeState: 'available' | 'cooldown' | 'quota_exhausted' | 'suspended'
  failureCount: number
  cooldownUntilMs?: number
  quotaExhaustedAtMs?: number
}

/** 合并账号库 meta（email/持久化 status）+ 运行态快照。供 IPC 查询账号池健康。 */
export function makeAccountPoolHealthHandler(health: AccountHealthTracker, accounts: KiroAccountPort) {
  return async (): Promise<AccountPoolHealthRow[]> => {
    const list = await accounts.listByPlatform()
    return list.map((a) => {
      const snap = health.snapshot(a.id)
      return {
        accountId: a.id,
        email: a.email,
        ...(a.status !== undefined ? { status: a.status } : {}),
        runtimeState: snap.runtimeState,
        failureCount: snap.failureCount,
        ...(snap.cooldownUntilMs !== undefined ? { cooldownUntilMs: snap.cooldownUntilMs } : {}),
        ...(snap.quotaExhaustedAtMs !== undefined ? { quotaExhaustedAtMs: snap.quotaExhaustedAtMs } : {}),
      }
    })
  }
}
