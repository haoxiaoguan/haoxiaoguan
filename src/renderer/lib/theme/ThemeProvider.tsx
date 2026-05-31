import { ThemeProvider as NextThemeProvider, type ThemeProviderProps } from 'next-themes';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

export function ThemeProvider({ children }: Props) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

export type { ThemeProviderProps };
