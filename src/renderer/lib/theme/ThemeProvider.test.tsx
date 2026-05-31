import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from './ThemeProvider';

describe('ThemeProvider', () => {
  it('renders children', () => {
    const { getByText } = render(
      <ThemeProvider>
        <span>theme-child</span>
      </ThemeProvider>,
    );

    expect(getByText('theme-child')).toBeInTheDocument();
  });
});
