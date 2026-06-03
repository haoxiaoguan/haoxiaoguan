import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'

/** 手动解除账号挂起：清运行态熔断/挂起 + 写回账号库 status=null。 */
export function makeClearSuspensionHandler(health: AccountHealthTracker, accounts: KiroAccountPort) {
  return async (accountId: string): Promise<void> => {
    health.clearSuspension(accountId)
    await accounts.clearSuspension(accountId)
  }
}
