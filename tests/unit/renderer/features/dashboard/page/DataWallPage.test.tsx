import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DataWallPage from '@/features/dashboard/page/DataWallPage';

const mocks = vi.hoisted(() => ({
  syncUsageSources: vi.fn().mockResolvedValue({ imported: 0, failed: 0, platforms: [] }),
  syncActivity: vi.fn().mockResolvedValue({ synced: 0 }),
  getUsageSummary: vi.fn().mockResolvedValue({
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 0,
  }),
  probeTools: vi.fn().mockResolvedValue([]),
  fetchAccounts: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/services/tauri', () => ({
  usageService: {
    syncUsageSources: mocks.syncUsageSources,
    getUsageSummary: mocks.getUsageSummary,
  },
  activityService: {
    syncActivity: mocks.syncActivity,
  },
  sessionsService: {
    probeTools: mocks.probeTools,
  },
  systemService: {
    onUsageSynced: () => () => {},
  },
}));

vi.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector?: (s: unknown) => unknown) => {
    const store = {
      accounts: new Map(),
      fetchAccounts: mocks.fetchAccounts,
    };
    return selector ? selector(store) : store;
  },
}));

// useAccountStats reads from accountStore internally
vi.mock('@/features/dashboard/hooks/useAccountStats', () => ({
  useAccountStats: () => ({
    total: 0,
    platformsCovered: 0,
    platformsTotal: 11,
    todayActive: 0,
    weekNew: 0,
    perPlatform: [],
  }),
}));

// useQuotaHealthSummary reads from multiple stores internally
vi.mock('@/features/dashboard/hooks/useQuotaHealthSummary', () => ({
  useQuotaHealthSummary: () => ({
    pool: { available: 0, cooldown: 0, exhausted: 0, total: 0, hasData: false },
    credential: { valid: 0, expiring: 0, invalid: 0, total: 0, hasData: false },
    attention: [],
    refresh: vi.fn(),
  }),
}));

// Recharts uses ResizeObserver; provide a stub
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('DataWallPage', () => {
  it('renders the grid container', () => {
    render(
      <MemoryRouter>
        <DataWallPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('datawall-grid')).toBeInTheDocument();
  });

  it('triggers fetchAccounts, syncUsageSources, syncActivity, and probeTools on mount', async () => {
    render(
      <MemoryRouter>
        <DataWallPage />
      </MemoryRouter>,
    );

    expect(mocks.fetchAccounts).toHaveBeenCalled();
    expect(mocks.syncUsageSources).toHaveBeenCalled();
    expect(mocks.syncActivity).toHaveBeenCalled();
    expect(mocks.probeTools).toHaveBeenCalled();
  });

  it('renders key card titles via i18n keys', () => {
    render(
      <MemoryRouter>
        <DataWallPage />
      </MemoryRouter>,
    );

    // AccountHeroCard title
    expect(screen.getByText('account.title')).toBeInTheDocument();
    // TrendChartCard title
    expect(screen.getByText('trend.title')).toBeInTheDocument();
    // PlatformDonutCard title
    expect(screen.getByText('platform.title')).toBeInTheDocument();
    // SessionActivityCard title
    expect(screen.getByText('session.title')).toBeInTheDocument();
  });
});
