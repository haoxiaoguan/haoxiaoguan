import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const THEMES = ['light', 'dark', 'system'] as const;
type Theme = (typeof THEMES)[number];

function nextTheme(current: Theme): Theme {
  const idx = THEMES.indexOf(current);
  return THEMES[(idx + 1) % THEMES.length];
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);

  // 避免 SSR 假设导致的水合不一致；Tauri 是 SPA 但 next-themes 仍需要这一步
  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (mounted ? (theme as Theme) : 'system') ?? 'system';
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;
  const label = t(`theme.toggle.switchTo.${nextTheme(current)}`);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={() => setTheme(nextTheme(current))}
    >
      <Icon className="h-[18px] w-[18px]" />
    </Button>
  );
}
