import { describe, it, expect } from 'vitest'
import { summarizeQuotaHealth } from '../../../../src/renderer/features/dashboard/utils/quota-health-summary'

const NOW_MS = new Date('2026-06-05T12:00:00Z').getTime()
const DAY_MS = 86_400_000
const SEVEN_DAYS_MS = 7 * DAY_MS

const ACCOUNTS = [
  { id: 'a1', platform: 'cursor',   displayIdentifier: 'user1@cursor.com' },
  { id: 'a2', platform: 'windsurf', displayIdentifier: 'user2@windsurf.io' },
  { id: 'a3', platform: 'kiro',     displayIdentifier: 'user3@kiro.dev' },
]

describe('summarizeQuotaHealth — pool', () => {
  it('maps ok/warning/exhausted statuses to correct buckets', () => {
    const quotaStates = new Map([
      ['a1', { status: 'ok' }],
      ['a2', { status: 'warning' }],
      ['a3', { status: 'exhausted' }],
    ])
    const { pool } = summarizeQuotaHealth(ACCOUNTS, quotaStates, new Map(), NOW_MS)

    expect(pool.available).toBe(1)
    expect(pool.cooldown).toBe(1)
    expect(pool.exhausted).toBe(1)
    expect(pool.total).toBe(3)
    expect(pool.hasData).toBe(true)
  })

  it('hasData is false when no quotaStates provided', () => {
    const { pool } = summarizeQuotaHealth(ACCOUNTS, new Map(), new Map(), NOW_MS)
    expect(pool.hasData).toBe(false)
    expect(pool.total).toBe(0)
  })
})

describe('summarizeQuotaHealth — credential', () => {
  it('valid without expiry → valid bucket', () => {
    const snapshots = new Map([
      ['a1', { validation: { state: 'valid' } }],
    ])
    const { credential } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.valid).toBe(1)
    expect(credential.expiring).toBe(0)
    expect(credential.invalid).toBe(0)
    expect(credential.total).toBe(1)
    expect(credential.hasData).toBe(true)
  })

  it('valid with expires_at > now+7d → valid bucket', () => {
    const expiresAt = new Date(NOW_MS + SEVEN_DAYS_MS + DAY_MS).toISOString()
    const snapshots = new Map([
      ['a1', { validation: { state: 'valid', expires_at: expiresAt } }],
    ])
    const { credential } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.valid).toBe(1)
    expect(credential.expiring).toBe(0)
  })

  it('valid with expires_at within 7 days → expiring bucket + attention item', () => {
    // Expires in 3 days
    const expiresAt = new Date(NOW_MS + 3 * DAY_MS).toISOString()
    const snapshots = new Map([
      ['a1', { validation: { state: 'valid', expires_at: expiresAt } }],
    ])
    const { credential, attention } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.expiring).toBe(1)
    expect(credential.valid).toBe(0)
    expect(attention).toHaveLength(1)
    expect(attention[0].kind).toBe('credExpiring')
    expect(attention[0].detail).toBe('3d')
    expect(attention[0].identifier).toBe('user1@cursor.com')
  })

  it('expired and revoked → invalid bucket', () => {
    const snapshots = new Map([
      ['a1', { validation: { state: 'expired' } }],
      ['a2', { validation: { state: 'revoked' } }],
    ])
    const { credential } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.invalid).toBe(2)
    expect(credential.total).toBe(2)
  })

  it('other states (rate_limited, network_error) do not count in any bucket but contribute to total', () => {
    const snapshots = new Map([
      ['a1', { validation: { state: 'rate_limited' } }],
    ])
    const { credential } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.valid).toBe(0)
    expect(credential.expiring).toBe(0)
    expect(credential.invalid).toBe(0)
    expect(credential.total).toBe(1)
  })

  it('hasData is false when no snapshots provided', () => {
    const { credential } = summarizeQuotaHealth(ACCOUNTS, new Map(), new Map(), NOW_MS)
    expect(credential.hasData).toBe(false)
  })
})

describe('summarizeQuotaHealth — attention', () => {
  it('exhausted quota → quotaExhausted attention item', () => {
    const quotaStates = new Map([['a1', { status: 'exhausted' }]])
    const { attention } = summarizeQuotaHealth(ACCOUNTS, quotaStates, new Map(), NOW_MS)
    expect(attention).toHaveLength(1)
    expect(attention[0].kind).toBe('quotaExhausted')
    expect(attention[0].accountId).toBe('a1')
    expect(attention[0].platform).toBe('cursor')
  })

  it('warning quota → quotaLow attention item', () => {
    const quotaStates = new Map([['a2', { status: 'warning' }]])
    const { attention } = summarizeQuotaHealth(ACCOUNTS, quotaStates, new Map(), NOW_MS)
    expect(attention).toHaveLength(1)
    expect(attention[0].kind).toBe('quotaLow')
    expect(attention[0].identifier).toBe('user2@windsurf.io')
  })

  it('returns empty attention and hasData=false for completely empty input', () => {
    const { pool, credential, attention } = summarizeQuotaHealth([], new Map(), new Map(), NOW_MS)
    expect(attention).toHaveLength(0)
    expect(pool.hasData).toBe(false)
    expect(credential.hasData).toBe(false)
  })

  it('7-day boundary: expires exactly at now+7d → expiring (≤ boundary)', () => {
    const expiresAt = new Date(NOW_MS + SEVEN_DAYS_MS).toISOString()
    const snapshots = new Map([
      ['a1', { validation: { state: 'valid', expires_at: expiresAt } }],
    ])
    const { credential, attention } = summarizeQuotaHealth(ACCOUNTS, new Map(), snapshots, NOW_MS)
    expect(credential.expiring).toBe(1)
    expect(attention[0].kind).toBe('credExpiring')
  })

  it('multiple accounts produce multiple attention items', () => {
    const quotaStates = new Map([
      ['a1', { status: 'exhausted' }],
      ['a2', { status: 'warning' }],
    ])
    const expiresAt = new Date(NOW_MS + 2 * DAY_MS).toISOString()
    const snapshots = new Map([
      ['a3', { validation: { state: 'valid', expires_at: expiresAt } }],
    ])
    const { attention } = summarizeQuotaHealth(ACCOUNTS, quotaStates, snapshots, NOW_MS)
    expect(attention).toHaveLength(3)
    const kinds = attention.map((a) => a.kind)
    expect(kinds).toContain('quotaExhausted')
    expect(kinds).toContain('quotaLow')
    expect(kinds).toContain('credExpiring')
  })
})
