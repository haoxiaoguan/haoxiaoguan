import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

// Mock the proxy service so the store's fetchAll resolves with fixtures.
const listProxies = vi.fn();
const listGroups = vi.fn();
const listBindings = vi.fn();
vi.mock('@/services/tauri', () => ({
  proxyService: {
    listProxies: () => listProxies(),
    listGroups: () => listGroups(),
    listBindings: () => listBindings(),
    testProxy: vi.fn(),
    testProxies: vi.fn(),
    createProxy: vi.fn(),
    updateProxy: vi.fn(),
    deleteProxy: vi.fn(),
    importProxies: vi.fn(),
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
    bindAccountToProxy: vi.fn(),
    bindAccountToGroup: vi.fn(),
    unbindAccount: vi.fn(),
  },
}));

import Proxies from '@/pages/Proxies';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <Proxies />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  listGroups.mockResolvedValue([]);
  listBindings.mockResolvedValue([]);
});

describe('Proxies page', () => {
  it('renders proxy rows with status and binding counts', async () => {
    listProxies.mockResolvedValue([
      {
        id: 'p1',
        label: 'east-1',
        protocol: 'http',
        host: '1.2.3.4',
        port: 8080,
        username: 'alice',
        passwordSet: true,
        status: 'ok',
        lastEgressIp: '9.9.9.9',
        lastLatencyMs: 120,
        tags: ['prod'],
        displayUrl: 'http://alice:***@1.2.3.4:8080',
        boundAccountCount: 3,
        boundGroupCount: 1,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    renderPage();

    const row = await screen.findByTestId('proxy-row');
    expect(within(row).getByText('east-1')).toBeInTheDocument();
    // redacted URL shows, never a plaintext password
    expect(within(row).getByText('http://alice:***@1.2.3.4:8080')).toBeInTheDocument();
    expect(within(row).getByText('9.9.9.9')).toBeInTheDocument();
    expect(within(row).getByText('120ms')).toBeInTheDocument();
    // binding count: "3 accounts / 1 groups" (en) or "3 个账号 / 1 组" (zh-CN)
    expect(within(row).getByText(/3 accounts \/ 1 groups|3 个账号 \/ 1 组/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no proxies', async () => {
    listProxies.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No proxies yet|还没有代理/)).toBeInTheDocument();
  });
});
