import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { AppShell } from './AppShell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderShell(shell: 'macos' | 'windows_like') {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell shell={shell} />}>
            <Route index element={<div>dashboard-page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('renders a fixed top safe area and sidebar safe-area for macOS only', () => {
    renderShell('macos');
    expect(screen.getByTestId('shell-safe-area-left')).toBeInTheDocument();
    expect(screen.getByTestId('shell-sidebar-safe-area')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-safe-area-right')).not.toBeInTheDocument();
  });

  it('renders a right safe area for windows-like shells (no macOS lanes)', () => {
    renderShell('windows_like');
    expect(screen.getByTestId('shell-safe-area-right')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-safe-area-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shell-sidebar-safe-area')).not.toBeInTheDocument();
  });

  it('exposes shell testids and renders the outlet content', () => {
    renderShell('macos');
    expect(screen.getByTestId('app-shell-frame')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-stage')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-header')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-content-scroll')).toHaveClass('min-w-0');
    expect(screen.getByTestId('app-shell-title')).toHaveTextContent('nav:dashboard');
    expect(screen.getByText('dashboard-page')).toBeInTheDocument();
  });

  it('renders brand and nav inside the sidebar', () => {
    renderShell('macos');

    const brand = screen.getByTestId('app-shell-brand');
    expect(within(brand).getAllByText('common:brand.name').length).toBeGreaterThan(0);

    const sidebar = screen.getByTestId('app-shell-sidebar');
    const navigation = within(sidebar).getByRole('navigation');
    expect(within(navigation).getAllByText('nav:dashboard').length).toBeGreaterThan(0);
    expect(within(navigation).getAllByText('nav:accounts').length).toBeGreaterThan(0);

    expect(screen.getByTestId('app-shell-user-card')).toBeInTheDocument();
  });

  it('renders the user card in the footer (no segmented theme toggle)', () => {
    renderShell('macos');
    expect(screen.getByTestId('app-shell-user-card')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-theme-toggle')).not.toBeInTheDocument();
  });

  it('renders the content area as a single rounded card with a fixed route header', () => {
    renderShell('macos');

    const stage = screen.getByTestId('app-shell-stage');
    // Inset card surface uses --card token (not --background) so it stands
    // out against the gray gutter painted by the frame.
    expect(stage.className).toMatch(/!bg-card/);

    const header = screen.getByTestId('app-shell-header');
    expect(header.className).toMatch(/border-b/);
    expect(header.className).toMatch(/shrink-0/);
    expect(screen.getByLabelText('common:sidebar.toggle')).toHaveClass('size-6');
    expect(screen.queryByTestId('app-shell-card-toolbar')).not.toBeInTheDocument();
  });

  it('starts with the sidebar expanded to match the high-fidelity shell', () => {
    renderShell('macos');

    const sidebar = screen.getByTestId('app-shell-sidebar');
    expect(sidebar.parentElement).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByTestId('app-shell-utility-actions')).toHaveClass('gap-1');
  });

  it('uses the account management title for account routes', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/accounts']}>
          <Routes>
            <Route element={<AppShell shell="macos" />}>
              <Route path="/accounts" element={<div>accounts-page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('app-shell-title')).toHaveTextContent('accounts:title');
  });

  it('renders Skills tabs in the route header instead of a plain title', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/skills']}>
          <Routes>
            <Route element={<AppShell shell="macos" />}>
              <Route path="/skills" element={<div>skills-page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(screen.queryByTestId('app-shell-title')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Skills 管理' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '发现技能' })).toHaveAttribute('aria-selected', 'false');
  });

  it('renders settings menu (with back item) when on a settings route', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/settings/general']}>
          <Routes>
            <Route element={<AppShell shell="macos" />}>
              <Route path="/settings/general" element={<div>general-page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
    const sidebar = screen.getByTestId('app-shell-sidebar');
    const nav = within(sidebar).getByRole('navigation');
    expect(within(nav).getAllByText('nav:settings.back').length).toBeGreaterThan(0);
    expect(within(nav).getAllByText('nav:settings.menu.general').length).toBeGreaterThan(0);
    expect(within(nav).queryByText('nav:dashboard')).not.toBeInTheDocument();
  });

  it('renders app menu without platforms item on main routes', () => {
    renderShell('macos');
    const sidebar = screen.getByTestId('app-shell-sidebar');
    const nav = within(sidebar).getByRole('navigation');
    expect(within(nav).queryByText('nav:platforms')).not.toBeInTheDocument();
  });
});
