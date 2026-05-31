import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuotaStateStore } from '../../stores';
import type { Account, AccountQuotaState } from '../../types';
import { AccountDataTable } from './AccountDataTable';

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

    expect(screen.getByText(/5小时额度 35% 剩余/)).toBeInTheDocument();
    expect(screen.getByText(/重置：/)).toBeInTheDocument();
  });

  it('does not show a validation pending state for Codex rows', () => {
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

    expect(screen.getAllByText('PRO 20x').length).toBeGreaterThan(0);
    expect(screen.queryByText('health.pending')).not.toBeInTheDocument();
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
});
