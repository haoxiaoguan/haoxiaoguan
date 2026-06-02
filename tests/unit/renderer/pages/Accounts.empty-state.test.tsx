import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Accounts from '@/pages/Accounts';

const mocks = vi.hoisted(() => ({
  accounts: new Map<string, unknown[]>(),
  fetchAccounts: vi.fn(async () => {}),
  switchAccount: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
  batchDelete: vi.fn(async () => {}),
  fetchPlatforms: vi.fn(async () => {}),
  refreshBatch: vi.fn(async () => {}),
  addAccountSheetProps: [] as Array<{ open: boolean; defaultPlatform?: string }>,
}));

function makeAccount(id: string, platform: string) {
  return {
    id,
    platform,
    email: `${id}@example.com`,
    identityKey: id,
    displayIdentifier: `${id}@example.com`,
    name: id,
    status: 'active',
    profilePayload: {},
    tags: [],
    notes: '',
    isActive: false,
    createdAt: '2026-05-20T00:00:00Z',
    lastUsedAt: '2026-05-25T00:00:00Z',
  };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/components/AddAccountSheet', () => ({
  default: (props: { open: boolean; defaultPlatform?: string }) => {
    mocks.addAccountSheetProps.push({
      open: props.open,
      defaultPlatform: props.defaultPlatform,
    });
    return <div data-testid="add-account-platform">{props.defaultPlatform}</div>;
  },
}));

vi.mock('@/stores', () => ({
  useAccountStore: (selector?: (state: {
    accounts: Map<string, unknown[]>;
    loading: boolean;
    fetchAccounts: (id: string) => Promise<void>;
    switchAccount: (id: string) => Promise<void>;
    deleteAccount: (id: string) => Promise<void>;
    batchDelete: (ids: string[]) => Promise<void>;
  }) => unknown) => {
    const state = {
      accounts: mocks.accounts,
      loading: false,
      fetchAccounts: mocks.fetchAccounts,
      switchAccount: mocks.switchAccount,
      deleteAccount: mocks.deleteAccount,
      batchDelete: mocks.batchDelete,
    };
    return selector ? selector(state) : state;
  },
  usePlatformStore: () => ({
    getDisplayName: (platform: string) => platform,
    fetchPlatforms: mocks.fetchPlatforms,
  }),
  useHealthStore: (selector?: (state: {
    refreshBatch: (ids: string[]) => Promise<void>;
    snapshots: Map<string, unknown>;
    refreshing: Set<string>;
  }) => unknown) => {
    const state = {
      refreshBatch: mocks.refreshBatch,
      snapshots: new Map<string, unknown>(),
      refreshing: new Set<string>(),
    };
    return selector ? selector(state) : state;
  },
  useQuotaStateStore: (selector: (state: {
    states: Map<string, unknown>;
    loading: Set<string>;
    errors: Map<string, string>;
    ensureMany: (ids: string[]) => Promise<void>;
    refresh: (id: string) => Promise<void>;
  }) => unknown) =>
    selector({
      states: new Map(),
      loading: new Set(),
      errors: new Map(),
      ensureMany: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    }),
  // EditAccountDialog (rendered by Accounts) reads the account-group store.
  useAccountGroupStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      groups: [] as unknown[],
      fetchGroups: vi.fn(async () => {}),
      addMembers: vi.fn(async () => 0),
      removeMembers: vi.fn(async () => 0),
    };
    return selector ? selector(state) : state;
  },
  // PlatformSettingsDialog (rendered by Accounts) reads the settings store.
  useSettingsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      refreshIntervals: new Map<string, number>(),
      platformRefreshIntervals: new Map<string, number>(),
      idePaths: {} as Record<string, string>,
      setRefreshInterval: vi.fn(async () => {}),
      setPlatformRefreshInterval: vi.fn(async () => {}),
      setIdePath: vi.fn(async () => {}),
      allowStaleKiroImport: false,
      setAllowStaleKiroImport: vi.fn(async () => {}),
    };
    return selector ? selector(state) : state;
  },
}));

// EditAccountDialog also reads the proxy store + proxy/account-group services.
vi.mock('@/stores/proxyStore', () => ({
  useProxyStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      proxies: [] as unknown[],
      fetchAll: vi.fn(async () => {}),
      bindAccountToProxy: vi.fn(async () => {}),
      unbindAccount: vi.fn(async () => {}),
    };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/services/tauri', () => ({
  accountGroupService: { listGroupsForAccount: vi.fn(async () => []) },
  proxyService: { getAccountBinding: vi.fn(async () => null) },
  credentialService: { startOAuth: vi.fn(), completeOAuth: vi.fn() },
  systemService: {
    pickPath: vi.fn(async () => null),
    detectAppPath: vi.fn(async () => ({ detected: null, suggestion: '' })),
    onQuotaUpdated: vi.fn(() => () => {}),
  },
}));

describe('Accounts empty state layout', () => {
  beforeEach(() => {
    mocks.accounts.clear();
    mocks.addAccountSheetProps = [];
  });

  it('keeps desktop toolbar controls ordered, adaptive, and icon-only where requested', () => {
    render(
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>,
    );

    const toolbar = screen.getByTestId('accounts-toolbar-row');
    const headerActions = screen.getByTestId('accounts-header-actions');
    const pageShell = screen.getByTestId('accounts-page-shell');
    const platformScroll = screen.getByTestId('accounts-platform-scroll');
    const dataScroll = screen.getByTestId('accounts-data-scroll');
    const platformNav = screen.getByRole('navigation', { name: '账号平台' });
    const accountSearch = screen.getByTestId('accounts-search');
    const tagFilter = screen.getByTestId('accounts-tag-filter');
    const statusFilter = screen.getByTestId('accounts-status-filter');
    const quotaFilter = screen.getByTestId('accounts-quota-filter');
    const sortFilter = screen.getByTestId('accounts-sort-filter');
    const viewToggle = screen.getByTestId('accounts-view-toggle');

    expect(pageShell).toHaveClass('overflow-hidden', 'w-full', 'min-w-0');
    expect(platformScroll).toHaveClass('min-h-0', 'flex-1');
    expect(dataScroll).toHaveClass('min-h-0', 'min-w-0', 'flex-1');
    expect(toolbar).toHaveClass('min-w-0', '2xl:flex-nowrap');
    expect(platformNav).toHaveTextContent('cursor');
    expect(platformNav).not.toHaveTextContent('filter.allPlatforms');
    expect(accountSearch.compareDocumentPosition(statusFilter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusFilter.compareDocumentPosition(tagFilter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tagFilter.compareDocumentPosition(quotaFilter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quotaFilter.compareDocumentPosition(sortFilter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewToggle.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolbar).not.toContainElement(viewToggle);
    expect(headerActions.lastElementChild).toBe(viewToggle);

    expect(accountSearch).toHaveClass('min-w-[180px]', 'flex-1');
    expect(accountSearch.querySelector('input')).toHaveClass('h-8');
    expect(statusFilter).toHaveClass('h-8');
    expect(tagFilter).toHaveClass('h-8');
    expect(quotaFilter).toHaveClass('h-8');
    expect(sortFilter).toHaveClass('h-8');
    expect(viewToggle).toHaveClass('h-8');
    expect(screen.queryByText('filter.allPlatforms')).not.toBeInTheDocument();

    expect(within(viewToggle).queryByText('view.card')).not.toBeInTheDocument();
    expect(within(viewToggle).queryByText('view.list')).not.toBeInTheDocument();
    expect(screen.queryByText('refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('等待同步')).not.toBeInTheDocument();
    expect(screen.queryByText('刚刚同步')).not.toBeInTheDocument();

    expect(screen.getByTestId('accounts-empty-state')).toHaveClass('min-h-[320px]');
    expect(screen.getByTestId('accounts-empty-icon')).toHaveClass('mx-auto');
    expect(screen.queryByText('detail.empty')).not.toBeInTheDocument();
  });

  it('opens add account for the currently selected platform', () => {
    render(
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /windsurf/i }));
    fireEvent.click(screen.getByLabelText('tooltips.add'));

    expect(mocks.addAccountSheetProps[mocks.addAccountSheetProps.length - 1]).toMatchObject({
      open: true,
      defaultPlatform: 'windsurf',
    });
  });

  it('orders platforms by account count and then the product priority list', () => {
    mocks.accounts.set('cursor', [
      makeAccount('cursor-1', 'cursor'),
      makeAccount('cursor-2', 'cursor'),
    ]);
    mocks.accounts.set('codex', [
      makeAccount('codex-1', 'codex'),
      makeAccount('codex-2', 'codex'),
    ]);
    mocks.accounts.set('windsurf', [makeAccount('windsurf-1', 'windsurf')]);
    mocks.accounts.set('antigravity', [makeAccount('antigravity-1', 'antigravity')]);
    mocks.accounts.set('gemini-cli', [makeAccount('gemini-1', 'gemini-cli')]);

    render(
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>,
    );

    const platformNav = screen.getByRole('navigation', { name: '账号平台' });
    const platformLabels = within(platformNav)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');

    expect(platformLabels.slice(0, 5)).toEqual([
      'codex2',
      'cursor2',
      'windsurf1',
      'antigravity1',
      'gemini-cli1',
    ]);
    expect(platformLabels).toContain('antigravity1');
  });

  it('uses a container-driven card grid instead of sizing by account count', () => {
    mocks.accounts.set('cursor', [
      {
        id: 'cursor-pro',
        platform: 'cursor',
        email: 'cursor@example.com',
        identityKey: 'auth0-user_abc123',
        displayIdentifier: 'cursor@example.com',
        name: 'Cursor Pro',
        planTier: 'pro',
        status: 'active',
        profilePayload: {},
        tags: ['Cursor', 'PRO'],
        notes: '',
        isActive: false,
        createdAt: '2026-05-20T00:00:00Z',
        lastUsedAt: '2026-05-25T00:00:00Z',
      },
    ]);

    render(
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /cursor/i }));
    const cardGrid = screen.getByRole('button', { name: /Cursor Pro/ }).parentElement;
    const cardRegion = cardGrid?.parentElement;

    expect(cardRegion).toHaveClass('accounts-card-region');
    expect(cardGrid).toHaveClass('accounts-card-grid');
    expect(cardGrid?.style.gridTemplateColumns).toBe('');
  });

  it('keeps table movement inside the table with fixed edge columns', () => {
    mocks.accounts.set('cursor', [
      {
        id: 'cursor-pro',
        platform: 'cursor',
        email: 'cursor@example.com',
        identityKey: 'auth0-user_abc123',
        displayIdentifier: 'cursor@example.com',
        name: 'Cursor Pro',
        planTier: 'pro',
        status: 'active',
        profilePayload: {},
        tags: ['Cursor', 'PRO'],
        notes: '',
        isActive: false,
        createdAt: '2026-05-20T00:00:00Z',
        lastUsedAt: '2026-05-25T00:00:00Z',
      },
    ]);

    render(
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /cursor/i }));
    fireEvent.click(screen.getByLabelText('tooltips.viewTable'));

    const accountTable = screen.getByTestId('accounts-table');
    const tableScroll = accountTable.firstElementChild;
    const [headerRow, dataRow] = screen.getAllByRole('row');

    expect(tableScroll).toHaveClass('overflow-auto');
    expect(within(accountTable).getByRole('table')).toHaveClass('min-w-[1040px]');
    expect(headerRow.children[0]).toHaveClass('sticky');
    expect(headerRow.children[0]).toHaveStyle({ left: '0px' });
    expect(headerRow.children[1]).toHaveClass('sticky');
    expect(headerRow.children[1]).toHaveStyle({ left: '44px' });
    expect(headerRow.children[8]).toHaveClass('sticky');
    expect(headerRow.children[8]).toHaveStyle({ right: '0px' });
    expect(dataRow.children[0]).toHaveClass('sticky');
    expect(dataRow.children[0]).toHaveClass('dt-cell-pinned');
    expect(dataRow.children[0]).toHaveStyle({ left: '0px' });
    expect(dataRow.children[1]).toHaveClass('sticky');
    expect(dataRow.children[1]).toHaveClass('dt-cell-pinned');
    expect(dataRow.children[1]).toHaveStyle({ left: '44px' });
    expect(dataRow.children[8]).toHaveClass('sticky');
    expect(dataRow.children[8]).toHaveClass('dt-cell-pinned');
    expect(dataRow.children[8]).toHaveStyle({ right: '0px' });
  });
});
