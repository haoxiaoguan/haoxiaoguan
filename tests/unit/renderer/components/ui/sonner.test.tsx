import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toast } from 'sonner';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';

describe('Toaster', () => {
  afterEach(() => {
    toast.dismiss();
  });

  it('does not apply DaisyUI toast layout classes to sonner items', async () => {
    render(
      <ThemeProvider>
        <Toaster position="top-center" richColors closeButton />
      </ThemeProvider>,
    );

    toast.success('导入成功');

    const item = await waitFor(() => {
      const toastItem = document.querySelector('[data-sonner-toast]');
      expect(toastItem).toBeInTheDocument();
      return toastItem as HTMLElement;
    });

    expect(item.classList.contains('toast')).toBe(false);
  });
});
