import { useMemo } from 'react'
import { useAccountStore } from '@/stores/accountStore'
import { computeAccountStats } from '../utils/account-stats'
import { DASHBOARD_PLATFORMS } from '../platforms'
import type { AccountStats } from '../utils/account-stats'

/**
 * Derive account statistics from the current account store snapshot.
 * Re-computes whenever the accounts map reference changes.
 */
export function useAccountStats(): AccountStats {
  const accounts = useAccountStore((s) => s.accounts)

  return useMemo(() => {
    // accountStore keyed by AgentId; values are Account[].
    // computeAccountStats expects Map<string, Array<{ createdAt, lastUsedAt? }>>
    const mapped = new Map<string, Array<{ createdAt: string; lastUsedAt?: string }>>()
    for (const [platform, list] of accounts) {
      mapped.set(
        platform,
        list.map((a) => ({ createdAt: a.createdAt, lastUsedAt: a.lastUsedAt })),
      )
    }
    return computeAccountStats(mapped, DASHBOARD_PLATFORMS, Date.now())
  }, [accounts])
}
