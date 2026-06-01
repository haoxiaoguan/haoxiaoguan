import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Groups from '@/pages/Groups';

// Renderer test for the redesigned Groups page (flat list + 3-step wizard).
// Stores + the proxy/account-group services are mocked so the table renders
// against controllable in-memory state and the wizard can open.

const mocks = vi.hoisted(() => ({
  groups: [
    {
      id: 'g-1',
      name: '客户 A',
      color: '#0ea5e9',
      description: 'first group',
      memberCount: 2,
      proxyBinding: { groupId: 'g-1', proxyId: 'p-1' },
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    },
    {
      id: 'g-2',
      name: '客户 B',
      memberCount: 0,
      createdAt: '2026-05-02T00:00:00Z',
      updatedAt: '2026-05-02T00:00:00Z',
    },
  ],
  fetchGroups: vi.fn(async () => {}),
  createGroup: vi.fn(async () => ({ id: 'g-new' })),
  updateGroup: vi.fn(async () => ({ id: 'g-1' })),
  deleteGroup: vi.fn(async () => {}),
  addMembers: vi.fn(async () => 0),
  removeMembers: vi.fn(async () => 0),
  bindGroupToProxy: vi.fn(async () => {}),
  unbindGroup: vi.fn(async () => {}),
  fetchAccounts: vi.fn(async () => {}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/stores', () => ({
  useAccountGroupStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      groups: mocks.groups,
      loading: false,
      error: null,
      fetchGroups: mocks.fetchGroups,
      createGroup: mocks.createGroup,
      updateGroup: mocks.updateGroup,
      deleteGroup: mocks.deleteGroup,
      addMembers: mocks.addMembers,
      removeMembers: mocks.removeMembers,
      bindGroupToProxy: mocks.bindGroupToProxy,
      unbindGroup: mocks.unbindGroup,
    };
    return selector ? selector(state) : state;
  },
  useAccountStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { accounts: new Map(), fetchAccounts: mocks.fetchAccounts };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/proxyStore', () => ({
  useProxyStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { proxies: [] as unknown[], fetchAll: vi.fn(async () => {}) };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/services/tauri', () => ({
  proxyService: { listGroups: vi.fn(async () => []) },
  accountGroupService: { listMembers: vi.fn(async () => []) },
}));

describe('Groups page (list + wizard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each group as a table row with its member count', () => {
    render(
      <MemoryRouter>
        <Groups />
      </MemoryRouter>,
    );
    expect(mocks.fetchGroups).toHaveBeenCalled();
    const rows = screen.getAllByTestId('group-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('客户 A')).toBeInTheDocument();
    // member count uses the interpolated key form
    expect(within(rows[0]).getByText('group.memberCount:{"count":2}')).toBeInTheDocument();
  });

  it('opens the wizard at step 1 when clicking 新建分组', () => {
    render(
      <MemoryRouter>
        <Groups />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'group.create' }));
    const dialog = screen.getByRole('dialog');
    // Step indicator shows step 1 of 3.
    expect(within(dialog).getByText(/group\.wizard\.stepOf/)).toBeInTheDocument();
    // The Next button is present (not Finish) on step 1.
    expect(within(dialog).getByRole('button', { name: /group\.wizard\.next/ })).toBeInTheDocument();
  });

  it('advances through the wizard steps with Next', () => {
    render(
      <MemoryRouter>
        <Groups />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'group.create' }));
    const dialog = screen.getByRole('dialog');
    // Step 1 requires a name before Next is enabled.
    const nameInput = within(dialog).getByPlaceholderText('group.wizard.namePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'New Group' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /group\.wizard\.next/ }));
    // Step 2 shows the member hint.
    expect(within(dialog).getByText('group.wizard.memberHint')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /group\.wizard\.next/ }));
    // Step 3 shows the Finish button.
    expect(within(dialog).getByRole('button', { name: /group\.wizard\.finish/ })).toBeInTheDocument();
  });
});
