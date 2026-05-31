import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddAccountSheet from './AddAccountSheet';
import zhOnboarding from '../locales/zh-CN/onboarding.json';

const mocks = vi.hoisted(() => ({
  completeOAuth: vi.fn(),
  importAccount: vi.fn(),
  getDisplayName: vi.fn((platform: string) => platform),
  open: vi.fn(),
  reset: vi.fn(),
  start: vi.fn(),
  startOAuth: vi.fn(),
  setPending: vi.fn(),
  setMaterial: vi.fn(),
  fail: vi.fn(),
  finish: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../services/tauri', () => ({
  credentialService: {
    startOAuth: mocks.startOAuth,
    completeOAuth: mocks.completeOAuth,
    importTokenJson: vi.fn(),
    scanLocalCredentials: vi.fn(),
    importDeeplink: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: mocks.open,
}));

vi.mock('../stores', () => ({
  useAccountStore: () => ({
    importAccount: mocks.importAccount,
  }),
  usePlatformStore: () => ({
    getDisplayName: mocks.getDisplayName,
  }),
  useOnboardingStore: () => ({
    reset: mocks.reset,
    start: mocks.start,
    setPending: mocks.setPending,
    setMaterial: mocks.setMaterial,
    fail: mocks.fail,
    finish: mocks.finish,
  }),
}));

describe('AddAccountSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the add account flow as a centered dialog instead of a right drawer', () => {
    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="cursor"
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '添加 cursor 账号' });

    expect(dialog).toHaveClass('left-[50%]', 'top-[50%]');
    expect(dialog).not.toHaveClass('right-0', 'inset-y-0', 'h-full');
  });

  it('stretches import method choices across the dialog width', () => {
    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="kiro"
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole('radiogroup')).toHaveClass('grid', 'w-full');
  });

  it('uses the selected account page platform in the dialog title without rendering platform chrome', () => {
    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="cursor"
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '添加 cursor 账号' })).toBeInTheDocument();
    expect(screen.queryByText('filter.platform')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('uses the requested short Chinese import method labels', () => {
    expect(zhOnboarding.method.local_scan).toBe('本地导入');
    expect(zhOnboarding.method.token_json).toBe('Token/JSON');
  });

  it('removes link import and resets to OAuth every time the dialog opens', () => {
    const { rerender } = render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="cursor"
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByRole('radio', { name: 'method.deep_link' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'method.local_scan' }));
    expect(screen.getByRole('radio', { name: 'method.local_scan' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    rerender(
      <AddAccountSheet
        open={false}
        onOpenChange={vi.fn()}
        defaultPlatform="cursor"
        onSuccess={vi.fn()}
      />,
    );
    rerender(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="cursor"
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'method.oauth' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'method.local_scan' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('opens the Kiro OAuth URL and completes the loopback import material', async () => {
    const pending = {
      pending_id: 'pending-1',
      authorize_url: 'https://app.kiro.dev/signin?state=s',
      redirect_path: '/oauth/callback',
      bound_port: 3128,
    };
    const material = {
      provider: 'kiro',
      email: 'kiro@example.com',
      access_token: 'access-token',
      source: 'oauth',
    };
    mocks.startOAuth.mockResolvedValue(pending);
    mocks.completeOAuth.mockResolvedValue(material);

    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="kiro"
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actions.open_browser' }));

    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(pending.authorize_url));
    expect(mocks.completeOAuth).toHaveBeenCalledWith(pending.pending_id, '');
    expect(mocks.setPending).toHaveBeenCalledWith(pending);
    expect(mocks.setMaterial).toHaveBeenCalledWith(material);
    expect(screen.getByText('kiro@example.com')).toBeInTheDocument();
  });

  it('labels a Kiro non-email identifier as user id in the review panel', async () => {
    const pending = {
      pending_id: 'pending-1',
      authorize_url: 'https://app.kiro.dev/signin?state=s',
      redirect_path: '/oauth/callback',
      bound_port: 3128,
    };
    mocks.startOAuth.mockResolvedValue(pending);
    mocks.completeOAuth.mockResolvedValue({
      provider: 'kiro',
      email: 'd-9067c98495.449',
      access_token: 'access-token',
      source: 'oauth',
    });

    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="kiro"
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actions.open_browser' }));

    await waitFor(() => expect(screen.getByText('d-9067c98495.449')).toBeInTheDocument());
    expect(screen.getByText('review.user_id:')).toBeInTheDocument();
  });

  it('passes OAuth metadata through when confirming import', async () => {
    const onSuccess = vi.fn();
    const pending = {
      pending_id: 'pending-1',
      authorize_url: 'https://app.kiro.dev/signin?state=s',
      redirect_path: '/oauth/callback',
      bound_port: 3128,
    };
    const material = {
      provider: 'kiro',
      email: 'd-9067c98495.449',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: '2026-06-01T00:00:00Z',
      source: 'oauth',
      raw_metadata: { userInfo: { userId: 'D-9067C98495.449' } },
    };
    mocks.startOAuth.mockResolvedValue(pending);
    mocks.completeOAuth.mockResolvedValue(material);
    mocks.importAccount.mockResolvedValue({});

    render(
      <AddAccountSheet
        open
        onOpenChange={vi.fn()}
        defaultPlatform="kiro"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actions.open_browser' }));
    await waitFor(() => expect(screen.getByText('d-9067c98495.449')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'actions.confirm' }));

    await waitFor(() => {
      expect(mocks.importAccount).toHaveBeenCalledWith({
        platform: 'kiro',
        email: 'd-9067c98495.449',
        token: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-06-01T00:00:00Z',
        rawMetadata: { userInfo: { userId: 'D-9067C98495.449' } },
        tags: [],
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });
});
