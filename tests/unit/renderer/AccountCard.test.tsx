import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHealthStore, useQuotaStateStore } from '@/stores';
import type { Account, AccountQuotaState } from '@/types';
import AccountCard from '@/components/accounts/AccountCard';

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

  it('shows the validation status badge in the corner and the plan in the body for Codex', () => {
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

    // Corner badge now reflects the real validation state (正常), same as other
    // platforms — not the plan and not a 未支持/pending placeholder.
    expect(screen.getByText('health.valid')).toBeInTheDocument();
    expect(screen.queryByText('health.pending')).not.toBeInTheDocument();
    expect(screen.queryByText('health.unsupported')).not.toBeInTheDocument();
    // The plan still appears in the body (会员计划 cell), just not the corner.
    expect(screen.getAllByText('PRO 20x').length).toBeGreaterThan(0);
  });

  it('shows the 刷新失败 badge instead of 正常 when the last quota refresh errored', () => {
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
      useQuotaStateStore.setState({
        states: new Map(),
        loading: new Set(),
        errors: new Map([[codexAccount.id, '通过代理连接失败：SocksClient internal error']]),
      });
    });

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

    // 刷新失败 → 角标降级为 refresh_error，不再显示 valid（正常）。
    expect(screen.getByText('health.refresh_error')).toBeInTheDocument();
    expect(screen.queryByText('health.valid')).not.toBeInTheDocument();
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

  it('marks the active account with an in-use chip while still showing its status', () => {
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
      <AccountCard
        account={codexAccount}
        platformDisplayName="Codex"
        selected={false}
        active
        onToggleSelect={() => {}}
        onSwitch={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
    );

    // The "in use" chip (card.active) marks which account the agent is using,
    // and the corner status badge still shows — the two no longer conflict.
    expect(screen.getByText('card.active')).toBeInTheDocument();
    expect(screen.getByText('health.valid')).toBeInTheDocument();
  });
});
