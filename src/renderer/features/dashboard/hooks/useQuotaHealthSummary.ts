import { useCallback, useMemo } from 'react'
import { useAccountStore } from '@/stores/accountStore'
import { useQuotaStateStore } from '@/stores/quotaStateStore'
import { useHealthStore } from '@/stores/healthStore'
import { summarizeQuotaHealth } from '../utils/quota-health-summary'
import { DASHBOARD_PLATFORMS } from '../platforms'
import type { PoolHealth, CredentialHealth, AttentionItem } from '../utils/quota-health-summary'

export interface UseQuotaHealthSummaryResult {
  pool: PoolHealth
  credential: CredentialHealth
  attention: AttentionItem[]
  /** Trigger a manual refresh of quota states + credential health. */
  refresh: () => Promise<void>
}

/**
 * Derive quota pool health, credential health, and attention items from
 * existing store snapshots.
 *
 * refresh() fetches fresh data on demand — it is NOT called automatically on
 * mount. This avoids kicking off expensive network requests on every navigation.
 */
export function useQuotaHealthSummary(): UseQuotaHealthSummaryResult {
  const accounts = useAccountStore((s) => s.accounts)
  const quotaStates = useQuotaStateStore((s) => s.states)
  const healthSnapshots = useHealthStore((s) => s.snapshots)
  const ensureMany = useQuotaStateStore((s) => s.ensureMany)
  const refreshBatch = useHealthStore((s) => s.refreshBatch)

  const flatAccounts = useMemo(() => {
    const result: Array<{ id: string; platform: string; displayIdentifier: string }> = []
    for (const platform of DASHBOARD_PLATFORMS) {
      const list = accounts.get(platform) ?? []
      for (const a of list) {
        result.push({ id: a.id, platform: a.platform, displayIdentifier: a.displayIdentifier })
      }
    }
    return result
  }, [accounts])

  const { pool, credential, attention } = useMemo(() => {
    // quotaStates: Map<accountId, AccountQuotaState>; status field is QuotaStatus string
    const qMap = new Map<string, { status: string }>()
    for (const [id, state] of quotaStates) {
      qMap.set(id, { status: state.status })
    }

    // healthSnapshots: Map<accountId, HealthSnapshot>; validation has state + expires_at
    const hMap = new Map<string, { validation: { state: string; expires_at?: string } }>()
    for (const [id, snap] of healthSnapshots) {
      hMap.set(id, {
        validation: {
          state: snap.validation.state,
          expires_at: snap.validation.expires_at,
        },
      })
    }

    return summarizeQuotaHealth(flatAccounts, qMap, hMap, Date.now())
  }, [flatAccounts, quotaStates, healthSnapshots])

  const refresh = useCallback(async () => {
    const ids = flatAccounts.map((a) => a.id)
    if (ids.length === 0) return
    await Promise.all([ensureMany(ids), refreshBatch(ids)])
  }, [flatAccounts, ensureMany, refreshBatch])

  return { pool, credential, attention, refresh }
}
