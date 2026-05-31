import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useSettingsStore } from '../../../stores';
import { changeLanguage, SUPPORTED_LANGUAGES } from '../../../i18n';
import { SettingsLayout } from '../SettingsLayout';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CloseWindowBehavior } from '../../../types';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_HSL,
  getStoredAccentColor,
  hexToHsl,
  hslToHex,
  setAccentColor,
} from '@/lib/theme/accent-color';

const THEMES = [
  { value: 'light', labelKey: 'settings.themeLight', icon: Sun },
  { value: 'dark', labelKey: 'settings.themeDark', icon: Moon },
  { value: 'system', labelKey: 'settings.themeSystem', icon: Monitor },
] as const;

export default function GeneralSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const {
    language, closeBehavior, silentStart, autostart,
    setLanguage, setCloseBehavior, setSilentStart, setAutostart,
  } = useSettingsStore();

  const [accent, setAccent] = useState<string>(() => getStoredAccentColor());
  const [hexInput, setHexInput] = useState<string>(() => hslToHex(getStoredAccentColor()));
  const [mounted, setMounted] = useState(false);

  // next-themes 在挂载前 theme 为 undefined，避免首帧选中态错位。
  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted ? (theme ?? 'system') : 'system';

  const applyAccent = (hsl: string) => {
    setAccent(hsl);
    setHexInput(hslToHex(hsl));
    setAccentColor(hsl);
  };

  const handleHexChange = (value: string) => {
    setHexInput(value);
    const hsl = hexToHsl(value);
    if (hsl) {
      setAccent(hsl);
      setAccentColor(hsl);
    }
  };

  const isPresetActive = (presetHsl: string) => accent === presetHsl;
  const isCustomActive = !ACCENT_PRESETS.some((p) => p.hsl === accent);

  return (
    <SettingsLayout
      title={t('settings.general.title', '通用')}
      description={t('settings.general.desc', '调整界面、语言与窗口行为。')}
    >
      {/* 外观 */}
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-5 py-3 text-sm font-semibold">
          {t('settings.general.appearance', '外观')}
        </header>
        <div className="divide-y divide-border/50">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm">{t('settings.theme')}</span>
            <ToggleGroup
              type="single"
              value={currentTheme}
              onValueChange={(v) => v && setTheme(v)}
              variant="outline"
              size="sm"
              className="gap-0 overflow-hidden rounded-lg [&>*:not(:first-child)]:border-l-0 [&>*:first-child]:rounded-l-lg [&>*:last-child]:rounded-r-lg [&>*]:rounded-none"
            >
              {THEMES.map((m) => {
                const Icon = m.icon;
                return (
                  <ToggleGroupItem
                    key={m.value}
                    value={m.value}
                    aria-label={t(m.labelKey)}
                    className="gap-1.5 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <Icon className="size-4" />
                    <span>{t(m.labelKey)}</span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          {/* 主题色 */}
          <div className="flex items-start justify-between px-5 py-4">
            <span className="pt-1 text-sm">{t('settings.accent.title', '主题色')}</span>
            <div className="flex flex-col items-end gap-3">
              <div className="flex items-center gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={t(preset.labelKey, preset.id)}
                    aria-pressed={isPresetActive(preset.hsl)}
                    onClick={() => applyAccent(preset.hsl)}
                    className={cn(
                      'size-7 rounded-full border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                      isPresetActive(preset.hsl)
                        ? 'border-foreground/80 ring-2 ring-foreground/20'
                        : 'border-border/60',
                    )}
                    style={{ backgroundColor: preset.hex }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label
                  className={cn(
                    'relative size-7 cursor-pointer overflow-hidden rounded-full border',
                    isCustomActive ? 'border-foreground/80 ring-2 ring-foreground/20' : 'border-border/60',
                  )}
                  style={{ backgroundColor: hexInput }}
                  title={t('settings.accent.custom', '自定义')}
                >
                  <input
                    type="color"
                    value={hexInput}
                    onChange={(e) => handleHexChange(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={t('settings.accent.custom', '自定义')}
                  />
                </label>
                <Input
                  value={hexInput}
                  onChange={(e) => handleHexChange(e.target.value)}
                  spellCheck={false}
                  className="h-8 w-28 font-mono text-xs uppercase"
                  aria-label={t('settings.accent.hex', '自定义颜色')}
                />
                <button
                  type="button"
                  onClick={() => applyAccent(DEFAULT_ACCENT_HSL)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('settings.accent.reset', '重置')}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm">{t('settings.language')}</span>
            <select
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
              value={language}
              onChange={(e) => { setLanguage(e.target.value); changeLanguage(e.target.value); }}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 窗口 */}
      <section className="rounded-xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-5 py-3 text-sm font-semibold">
          {t('settings.general.window', '窗口')}
        </header>
        <div className="divide-y divide-border/50">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm">{t('settings.closeBehavior')}</span>
            <ToggleGroup
              type="single"
              value={closeBehavior}
              onValueChange={(v) => v && setCloseBehavior(v as CloseWindowBehavior)}
              variant="outline"
              size="sm"
              className="gap-0 overflow-hidden rounded-lg [&>*:not(:first-child)]:border-l-0 [&>*:first-child]:rounded-l-lg [&>*:last-child]:rounded-r-lg [&>*]:rounded-none"
            >
              {(['minimize', 'quit'] as CloseWindowBehavior[]).map((b) => (
                <ToggleGroupItem
                  key={b}
                  value={b}
                  className="px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {b === 'minimize' ? t('settings.closeBehaviorMinimize') : t('settings.closeBehaviorQuit')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm">{t('settings.general.autostart', '开机自启')}</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              aria-label={t('settings.general.autostart', '开机自启')}
            />
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm">{t('settings.general.silentStart', '静默启动')}</span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={silentStart}
              onChange={(e) => setSilentStart(e.target.checked)}
              aria-label={t('settings.general.silentStart', '静默启动')}
            />
          </div>
        </div>
      </section>
    </SettingsLayout>
  );
}
