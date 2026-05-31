import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './theme-toggle';
import { ThemeProvider } from './ThemeProvider';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('renders a button with an aria-label that names the next theme', () => {
    const { getByRole } = renderToggle();
    const btn = getByRole('button');
    expect(btn).toBeInTheDocument();
    // 默认 system → 下一个是 light
    expect(btn.getAttribute('aria-label')).toContain('light');
  });

  it('cycles through theme states on click', () => {
    const { getByRole } = renderToggle();
    const btn = getByRole('button');
    // system → light
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toContain('dark');
    // light → dark
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toContain('system');
    // dark → system
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toContain('light');
  });
});
