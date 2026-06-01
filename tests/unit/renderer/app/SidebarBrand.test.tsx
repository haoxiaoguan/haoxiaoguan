import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarBrand } from '@/app/SidebarBrand';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('SidebarBrand', () => {
  it('renders product name and tagline via i18n keys with the brand testid wrapper', () => {
    const { getByText, getByTestId } = render(<SidebarBrand shell="macos" />);
    expect(getByText('common:brand.name')).toBeInTheDocument();
    expect(getByText('common:brand.tagline')).toBeInTheDocument();
    expect(getByTestId('app-shell-brand')).toBeInTheDocument();
  });

  it('reserves a top safe area for macOS traffic lights', () => {
    const { getByTestId } = render(<SidebarBrand shell="macos" />);
    expect(getByTestId('shell-sidebar-safe-area')).toBeInTheDocument();
  });

  it('omits the macOS safe area on windows-like shells', () => {
    const { queryByTestId } = render(<SidebarBrand shell="windows_like" />);
    expect(queryByTestId('shell-sidebar-safe-area')).not.toBeInTheDocument();
  });
});
