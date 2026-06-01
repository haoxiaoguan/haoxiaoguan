import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Account, AccountQuotaState } from '@/types';
import {
  getPlatformMetricBadge,
  PlatformMetricBlock,
  PlatformMetricSummary,
} from '@/components/accounts/PlatformMetrics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const baseAccount: Account = {
  id: 'a1',
  platform: 'cursor',
  email: 'bubblecam@126.com',
  identityKey: 'bubblecam@126.com',
  displayIdentifier: 'bubblecam@126.com',
  name: 'Cursor Pro',
  profilePayload: {},
  tags: ['Cursor', 'PRO'],
  isActive: false,
  createdAt: '2026-05-01T10:00:00Z',
  lastUsedAt: '2026-05-25T08:00:00Z',
};

const cursorQuotaState: AccountQuotaState = {
  version: 1,
  status: 'ok',
  primaryMetricKey: 'total_usage',
  metrics: [
    {
      key: 'total_usage',
      label: 'Total Usage',
      kind: 'usage',
      unit: 'percent',
      used: 40,
      total: 100,
      remaining: 60,
      percentUsed: 40,
      percentRemaining: 60,
      displayValue: '40%',
      status: 'ok',
    },
    {
      key: 'auto_composer',
      label: 'Auto + Composer',
      kind: 'usage',
      unit: 'percent',
      percentUsed: 51,
      displayValue: '51%',
      status: 'ok',
    },
    {
      key: 'api_usage',
      label: 'API Usage',
      kind: 'usage',
      unit: 'percent',
      percentUsed: 1,
      displayValue: '1%',
      status: 'ok',
    },
  ],
  fetchedAt: '2026-05-26T00:00:00Z',
  providerPayload: { plan: 'PRO' },
};

describe('PlatformMetrics', () => {
  it('renders only the primary quota metric in list summary', () => {
    render(<PlatformMetricSummary account={baseAccount} quotaState={cursorQuotaState} />);

    expect(screen.getByText('Total Usage 40%')).toBeInTheDocument();
    expect(screen.queryByText('Auto + Composer 51%')).not.toBeInTheDocument();
    expect(screen.queryByText('API Usage 1%')).not.toBeInTheDocument();
  });

  it('renders all quota metrics in card block', () => {
    render(<PlatformMetricBlock account={baseAccount} quotaState={cursorQuotaState} />);

    expect(screen.getByText('Total Usage')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Auto + Composer')).toBeInTheDocument();
    expect(screen.getByText('51%')).toBeInTheDocument();
    expect(screen.getByText('API Usage')).toBeInTheDocument();
    expect(screen.getByText('1%')).toBeInTheDocument();
  });

  it('renders unsupported quota as a distinct state', () => {
    render(
      <PlatformMetricSummary
        account={{ ...baseAccount, platform: 'github-copilot' }}
        quotaState={{
          version: 1,
          status: 'unsupported',
          metrics: [],
          providerPayload: {},
        }}
      />,
    );

    expect(screen.getByText('额度未支持')).toBeInTheDocument();
  });

  it('uses account profile fields when quota state has not been fetched', () => {
    render(
      <PlatformMetricBlock
        account={{
          ...baseAccount,
          planTier: 'pro',
          loginProvider: 'GitHub',
          status: 'active',
        }}
      />,
    );

    expect(screen.getByText('套餐')).toBeInTheDocument();
    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByText('登录来源')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('平台状态')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('derives the card badge from account profile instead of platform defaults', () => {
    expect(getPlatformMetricBadge({ ...baseAccount, planTier: 'pro' })).toBe('PRO');
    expect(getPlatformMetricBadge({ ...baseAccount, planTier: undefined, planName: 'Team' })).toBe('Team');
    expect(
      getPlatformMetricBadge({
        ...baseAccount,
        planTier: undefined,
        planName: undefined,
        loginProvider: 'AWS SSO',
      }),
    ).toBe('AWS SSO');
  });
});
