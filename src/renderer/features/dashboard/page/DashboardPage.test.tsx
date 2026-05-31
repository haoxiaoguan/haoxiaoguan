import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const mocks = vi.hoisted(() => ({
  syncUsageSources: vi.fn().mockResolvedValue({ imported: 0, failed: 0, platforms: [] }),
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
  },
}));

vi.mock('@/stores/accountStore', () => ({
  useAccountStore: () => ({
    accounts: new Map(),
    activeAccounts: new Map(),
    fetchAccounts: mocks.fetchAccounts,
  }),
}));

describe('DashboardPage', () => {
  it('renders KPI cards, active account, data health, and trend heatmap inside the scroll container', () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // Page header keys passthrough
    expect(screen.getByText('dashboard:title')).toBeInTheDocument();
    expect(screen.getByText('dashboard:subtitle')).toBeInTheDocument();

    const scrollContainer = screen.getByTestId('dashboard-page-scroll-container');
    expect(scrollContainer).toBeInTheDocument();

    // KPI labels
    expect(screen.getByText('dashboard:kpis.accounts')).toBeInTheDocument();
    expect(screen.getByText('dashboard:kpis.mcp')).toBeInTheDocument();
    expect(screen.getByText('dashboard:kpis.skills')).toBeInTheDocument();

    // Mid row + heatmap
    expect(screen.getByText('dashboard:activeAccount.title')).toBeInTheDocument();
    expect(screen.getByText('dashboard:health.title')).toBeInTheDocument();
    expect(screen.getByText('dashboard:trend.title')).toBeInTheDocument();
  });

  it('triggers store fetches and a usage sync on mount', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(mocks.fetchAccounts).toHaveBeenCalled();
    expect(mocks.syncUsageSources).toHaveBeenCalled();
  });
});

