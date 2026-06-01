import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHealthStore, useQuotaStateStore } from '@/stores';
import type { Account, AccountQuotaState } from '@/types';
import { AccountDataTable } from '@/components/accounts/AccountDataTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const codexAccount: Account = {
  id: 'codex-1',
  platform: 'codex',
  email: 'codex-account',
  identityKey: 'codex-account',
  displayIdentifier: 'codex-account',
  name: 'Codex Plus',
  planName: 'Plus',
  profilePayload: {},
  tags: ['Codex'],
  isActive: false,
  createdAt: '2026-05-01T10:00:00Z',
};

const codexQuotaState: AccountQuotaState = {
  version: 1,
  status: 'ok',
  primaryMetricKey: 'codex_hourly',
  metrics: [
    {
      key: 'codex_hourly',
      label: '5小时额度',
      kind: 'remaining',
      unit: 'percent',
      percentUsed: 65,
      percentRemaining: 35,
      displayValue: '35% 剩余',
      window: 'hour',
      resetAt: '2026-05-28T12:00:00Z',
      status: 'ok',
    },
    {
      key: 'codex_weekly',
      label: '周额度',
      kind: 'remaining',
      unit: 'percent',
      percentUsed: 20,
      percentRemaining: 80,
      displayValue: '80% 剩余',
      window: 'billing_cycle',
      resetAt: '2026-05-31T12:00:00Z',
      status: 'ok',
    },
  ],
  fetchedAt: '2026-05-28T08:00:00Z',
  providerPayload: {},
};

describe('AccountDataTable', () => {
  afterEach(() => {
    act(() => {
      useQuotaStateStore.getState().clear();
      useHealthStore.getState().clear();
    });
  });

  it('shows the primary Codex quota reset time in table view', () => {
    act(() => {
      useQuotaStateStore.setState({
        states: new Map([[codexAccount.id, codexQuotaState]]),
        loading: new Set(),
        errors: new Map(),
      });
    });

    render(
      <AccountDataTable
        accounts={[codexAccount]}
        platformDisplayName={() => 'Codex'}
        selectedIds={new Set()}
        highlightedId={null}
        switchingId={null}
        onToggleSelectAll={() => {}}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    // The quota cell renders label and percent in separate spans (redesigned
    // three-part layout), so match them independently rather than as one node.
    expect(screen.getByText('5小时额度')).toBeInTheDocument();
    expect(screen.getByText('35% 剩余')).toBeInTheDocument();
    expect(screen.getByText(/重置：/)).toBeInTheDocument();
  });

  it('shows the quota fetchedAt as the sync time, not the account createdAt', () => {
    // createdAt is the import time (old); fetchedAt is bumped on every refresh.
    // The 同步时间 column must track fetchedAt so a refresh visibly updates it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T08:05:00Z'));
    try {
      act(() => {
        useQuotaStateStore.setState({
          states: new Map([[codexAccount.id, codexQuotaState]]), // fetchedAt 08:00 → "5 分钟前"
          loading: new Set(),
          errors: new Map(),
        });
      });

      render(
        <AccountDataTable
          accounts={[codexAccount]} // createdAt 2026-05-01 → would be "27 天前"
          platformDisplayName={() => 'Codex'}
          selectedIds={new Set()}
          highlightedId={null}
          switchingId={null}
          onToggleSelectAll={() => {}}
          onToggleSelect={() => {}}
          onSwitch={() => {}}
          onDelete={() => {}}
          onOpen={() => {}}
        />,
      );

      expect(screen.getByText('5 分钟前')).toBeInTheDocument();
      expect(screen.queryByText(/天前/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the validation status (not a plan/pending placeholder) in the Codex status column', () => {
    act(() => {
      useHealthStore.setState({
        snapshots: new Map([
          [
            codexAccount.id,
            {
              account_id: codexAccount.id,
              validation: { state: 'valid', checked_at: '2026-05-28T08:00:00Z' },
              quota: undefined,
              checked_at: '2026-05-28T08:00:00Z',
            },
          ],
        ]),
        refreshing: new Set(),
        lastBatchAt: null,
      });
    });

    render(
      <AccountDataTable
        accounts={[{ ...codexAccount, planName: 'pro', planTier: 'pro' }]}
        platformDisplayName={() => 'Codex'}
        selectedIds={new Set()}
        highlightedId={null}
        switchingId={null}
        onToggleSelectAll={() => {}}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    // Status column now reflects the real validation state (正常), same as other
    // platforms — never 未支持/pending.
    expect(screen.getByText('health.valid')).toBeInTheDocument();
    expect(screen.queryByText('health.pending')).not.toBeInTheDocument();
    expect(screen.queryByText('health.unsupported')).not.toBeInTheDocument();
    // The plan still appears in the dedicated 会员计划 column.
    expect(screen.getAllByText('PRO 20x').length).toBeGreaterThan(0);
  });

  it('shows the Codex membership expiry under the plan in table view', () => {
    render(
      <AccountDataTable
        accounts={[{
          ...codexAccount,
          planName: 'pro',
          planTier: 'pro',
          profilePayload: {
            subscriptionActiveUntil: '2099-06-25T23:59:00Z',
          },
        }]}
        platformDisplayName={() => 'Codex'}
        selectedIds={new Set()}
        highlightedId={null}
        switchingId={null}
        onToggleSelectAll={() => {}}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText(/到期：/)).toBeInTheDocument();
    expect(screen.getByText(/2099/)).toBeInTheDocument();
  });

  it('marks the active account with an in-use chip in the identity cell', () => {
    render(
      <AccountDataTable
        accounts={[{ ...codexAccount, isActive: true }]}
        platformDisplayName={() => 'Codex'}
        selectedIds={new Set()}
        highlightedId={null}
        switchingId={null}
        onToggleSelectAll={() => {}}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    // The agent's current account is marked "in use" (card.active) in the
    // identity cell, distinct from the status column.
    expect(screen.getByText('card.active')).toBeInTheDocument();
  });
});
