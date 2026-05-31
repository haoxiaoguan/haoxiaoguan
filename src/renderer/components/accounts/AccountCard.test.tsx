import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHealthStore, useQuotaStateStore } from '../../stores';
import type { Account, AccountQuotaState } from '../../types';
import AccountCard from './AccountCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const codexAccount: Account = {
  id: 'codex-1',
  platform: 'codex',
  email: 'codex@example.com',
  identityKey: 'codex_123',
  displayIdentifier: 'codex@example.com',
  name: 'Codex Pro',
  planName: 'pro',
  planTier: 'pro',
  profilePayload: {},
  tags: ['Codex'],
  isActive: false,
  createdAt: '2026-05-01T10:00:00Z',
};

const codexQuotaState: AccountQuotaState = {
  version: 1,
  status: 'ok',
  metrics: [
    {
      key: 'codex_hourly',
      label: '5小时额度',
      kind: 'remaining',
      unit: 'percent',
      percentRemaining: 85,
      percentUsed: 15,
      displayValue: '85% 剩余',
      status: 'ok',
    },
  ],
  providerPayload: {},
};

describe('AccountCard', () => {
  afterEach(() => {
    useHealthStore.getState().clear();
    useQuotaStateStore.getState().clear();
  });

  it('uses the Codex plan badge instead of a validation pending badge', () => {
    render(
      <AccountCard
        account={codexAccount}
        platformDisplayName="Codex"
        selected={false}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(screen.getAllByText('PRO 20x').length).toBeGreaterThan(0);
    expect(screen.queryByText('health.pending')).not.toBeInTheDocument();
  });

  it('shows the Codex membership expiry when available', () => {
    act(() => {
      useQuotaStateStore.setState({
        states: new Map([[codexAccount.id, codexQuotaState]]),
        loading: new Set(),
        errors: new Map(),
      });
    });

    render(
      <AccountCard
        account={{
          ...codexAccount,
          profilePayload: {
            subscriptionActiveUntil: '2099-06-25T23:59:00Z',
          },
        }}
        platformDisplayName="Codex"
        selected={false}
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('会员有效期')).toBeInTheDocument();
    expect(screen.getByText(/2099/)).toBeInTheDocument();
  });
});
