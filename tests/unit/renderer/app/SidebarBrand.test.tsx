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

  it('also reserves the top spacer on windows-like shells (logo 下移对齐 + 拖拽区)', () => {
    // 自 feat(window) logo 下移：Windows/Linux 无红绿灯，但保留同高顶部留白，
    // 既与右侧 header 行对齐，又充当标题栏拖拽区（见 SidebarBrand 组件注释）。
    const { getByTestId } = render(<SidebarBrand shell="windows_like" />);
    expect(getByTestId('shell-sidebar-safe-area')).toBeInTheDocument();
  });
});
