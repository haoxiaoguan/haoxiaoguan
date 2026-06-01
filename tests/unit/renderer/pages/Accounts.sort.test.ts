import { describe, expect, it } from 'vitest';
import type { Account, AccountQuotaState } from '@/types';
import { compareAccounts } from '@/pages/Accounts';

function account(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    platform: 'codex',
    email: `${id}@example.com`,
    identityKey: id,
    displayIdentifier: `${id}@example.com`,
    profilePayload: {},
    tags: [],
    isActive: false,
    createdAt: '2026-05-01T10:00:00Z',
    ...over,
  };
}

const noQuota = new Map<string, AccountQuotaState>();

describe('compareAccounts active-first pinning', () => {
  it('sorts the active account ahead of inactive ones regardless of sort mode', () => {
    const active = account('zzz', { isActive: true, name: 'ZZZ' });
    const inactive = account('aaa', { name: 'AAA' });

    // Even under name sort (where AAA < ZZZ), the active account wins the top.
    expect(compareAccounts(active, inactive, 'name', noQuota)).toBeLessThan(0);
    expect(compareAccounts(inactive, active, 'name', noQuota)).toBeGreaterThan(0);
    expect(compareAccounts(active, inactive, 'recent', noQuota)).toBeLessThan(0);
    expect(compareAccounts(active, inactive, 'quota', noQuota)).toBeLessThan(0);
  });

  it('falls back to the chosen sort mode when neither is active', () => {
    const a = account('aaa', { name: 'AAA' });
    const z = account('zzz', { name: 'ZZZ' });
    expect(compareAccounts(a, z, 'name', noQuota)).toBeLessThan(0); // AAA before ZZZ
  });
});
