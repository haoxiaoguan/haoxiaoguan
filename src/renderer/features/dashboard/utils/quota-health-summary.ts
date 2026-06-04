export interface PoolHealth {
  available: number
  cooldown: number
  exhausted: number
  total: number
  hasData: boolean
}

export interface CredentialHealth {
  valid: number
  expiring: number
  invalid: number
  total: number
  hasData: boolean
}

export interface AttentionItem {
  accountId: string
  platform: string
  identifier: string
  kind: 'quotaExhausted' | 'quotaLow' | 'credExpiring'
  detail: string
}

const SEVEN_DAYS_MS = 7 * 86_400_000

/**
 * Summarize quota pool health, credential health, and attention items.
 *
 * @param accounts         Flat list of accounts with id, platform, and
 *   displayIdentifier.
 * @param quotaStates      Map<accountId, { status: string }> — only accounts
 *   present in this map contribute to pool stats.
 * @param healthSnapshots  Map<accountId, { validation: { state: string;
 *   expires_at?: string } }> — only accounts present contribute to credential
 *   stats.
 * @param nowMs            Reference timestamp in milliseconds.
 */
export function summarizeQuotaHealth(
  accounts: Array<{ id: string; platform: string; displayIdentifier: string }>,
  quotaStates: Map<string, { status: string }>,
  healthSnapshots: Map<string, { validation: { state: string; expires_at?: string } }>,
  nowMs: number,
): { pool: PoolHealth; credential: CredentialHealth; attention: AttentionItem[] } {
  const pool: PoolHealth = {
    available: 0,
    cooldown: 0,
    exhausted: 0,
    total: 0,
    hasData: false,
  }

  const credential: CredentialHealth = {
    valid: 0,
    expiring: 0,
    invalid: 0,
    total: 0,
    hasData: false,
  }

  const attention: AttentionItem[] = []

  for (const account of accounts) {
    const { id, platform, displayIdentifier } = account

    // ── Pool health ───────────────────────────────────────────────────────
    const qState = quotaStates.get(id)
    if (qState !== undefined) {
      const { status } = qState
      if (status === 'ok') {
        pool.available++
      } else if (status === 'warning') {
        pool.cooldown++
        attention.push({
          accountId: id,
          platform,
          identifier: displayIdentifier,
          kind: 'quotaLow',
          detail: 'warning',
        })
      } else if (status === 'exhausted') {
        pool.exhausted++
        attention.push({
          accountId: id,
          platform,
          identifier: displayIdentifier,
          kind: 'quotaExhausted',
          detail: 'exhausted',
        })
      }
    }

    // ── Credential health ─────────────────────────────────────────────────
    const snap = healthSnapshots.get(id)
    if (snap !== undefined) {
      const { state, expires_at } = snap.validation

      if (state === 'expired' || state === 'revoked') {
        credential.invalid++
      } else if (state === 'valid') {
        if (expires_at) {
          const expiresMs = new Date(expires_at).getTime()
          if (expiresMs <= nowMs + SEVEN_DAYS_MS) {
            // Expiring within 7 days
            credential.expiring++
            const daysLeft = Math.max(0, Math.floor((expiresMs - nowMs) / 86_400_000))
            attention.push({
              accountId: id,
              platform,
              identifier: displayIdentifier,
              kind: 'credExpiring',
              detail: `${daysLeft}d`,
            })
          } else {
            credential.valid++
          }
        } else {
          // No expiry — permanently valid
          credential.valid++
        }
      }
      // Other states (rate_limited, network_error, unknown_error, etc.) are
      // intentionally ignored: they don't contribute to any bucket.
    }
  }

  // total = sum of classified buckets, so the stacked bar and the "x / total"
  // label stay consistent. Accounts in unclassified states (quota
  // unknown/unsupported/error; credential rate_limited/network_error/pending/…)
  // are simply not counted as pool/credential members rather than inflating the
  // denominator and making the segments add up to less than the whole.
  pool.total = pool.available + pool.cooldown + pool.exhausted
  credential.total = credential.valid + credential.expiring + credential.invalid
  pool.hasData = pool.total > 0
  credential.hasData = credential.total > 0

  return { pool, credential, attention }
}
