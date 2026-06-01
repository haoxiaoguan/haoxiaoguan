import { create } from 'zustand';
import type { ThemeMode, CloseWindowBehavior, PlatformId } from '../types';
import { settingsService } from '../services/tauri';

interface SettingsState {
  /** Current theme mode */
  theme: ThemeMode;
  /** Current language */
  language: string;
  /** Per-platform refresh intervals in minutes */
  refreshIntervals: Map<PlatformId, number>;
  /** Window close behavior */
  closeBehavior: CloseWindowBehavior;
  /** WebSocket port */
  wsPort: number;
  /** Silent start (launch hidden to tray) */
  silentStart: boolean;
  /** Launch on system startup */
  autostart: boolean;
  /** Comma-separated enabled top utility buttons */
  utilityButtons: string;
  /** Allow Kiro import when identity cannot be confirmed online */
  allowStaleKiroImport: boolean;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;

  /** Load settings from backend */
  loadSettings: () => Promise<void>;
  /** Update theme */
  setTheme: (theme: ThemeMode) => Promise<void>;
  /** Update language */
  setLanguage: (language: string) => Promise<void>;
  /** Update refresh interval for a platform */
  setRefreshInterval: (platform: PlatformId, minutes: number) => Promise<void>;
  /** Update close behavior */
  setCloseBehavior: (behavior: CloseWindowBehavior) => Promise<void>;
  /** Update WebSocket port */
  setWsPort: (port: number) => Promise<void>;
  /** Update silent start */
  setSilentStart: (enabled: boolean) => Promise<void>;
  /** Update autostart */
  setAutostart: (enabled: boolean) => Promise<void>;
  /** Update utility buttons */
  setUtilityButtons: (value: string) => Promise<void>;
  /** Update allow-stale-Kiro-import toggle */
  setAllowStaleKiroImport: (enabled: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'system',
  language: 'en',
  refreshIntervals: new Map(),
  closeBehavior: 'minimize',
  wsPort: 19528,
  silentStart: false,
  autostart: false,
  utilityButtons: 'device,support,docs,notification',
  allowStaleKiroImport: false,
  loading: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await settingsService.getSettings();
      const refreshIntervals = new Map<PlatformId, number>();
      for (const [key, value] of Object.entries(settings.refreshIntervals)) {
        refreshIntervals.set(key as PlatformId, value);
      }
      set({
        theme: settings.theme as ThemeMode,
        language: settings.language,
        closeBehavior: settings.closeBehavior as CloseWindowBehavior,
        wsPort: settings.wsPort,
        refreshIntervals,
        silentStart: settings.silentStart,
        autostart: settings.autostart,
        utilityButtons: settings.utilityButtons,
        allowStaleKiroImport: settings.allowStaleKiroImport,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  setTheme: async (theme: ThemeMode) => {
    try {
      await settingsService.updateSettings({ settings: { theme } });
      set({ theme });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setLanguage: async (language: string) => {
    try {
      await settingsService.updateSettings({ settings: { language } });
      set({ language });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setRefreshInterval: async (platform: PlatformId, minutes: number) => {
    try {
      await settingsService.updateSettings({
        settings: { [`refresh_interval_${platform}`]: String(minutes) },
      });
      const refreshIntervals = new Map(get().refreshIntervals);
      refreshIntervals.set(platform, minutes);
      set({ refreshIntervals });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setCloseBehavior: async (behavior: CloseWindowBehavior) => {
    try {
      await settingsService.updateSettings({ settings: { close_behavior: behavior } });
      set({ closeBehavior: behavior });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setWsPort: async (port: number) => {
    try {
      await settingsService.updateSettings({ settings: { ws_port: String(port) } });
      set({ wsPort: port });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setSilentStart: async (enabled: boolean) => {
    try {
      await settingsService.updateSettings({ settings: { silent_start: enabled ? 'true' : 'false' } });
      set({ silentStart: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setAutostart: async (enabled: boolean) => {
    try {
      await settingsService.setAutostart(enabled);
      set({ autostart: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setUtilityButtons: async (value: string) => {
    try {
      await settingsService.updateSettings({ settings: { utility_buttons: value } });
      set({ utilityButtons: value });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setAllowStaleKiroImport: async (enabled: boolean) => {
    try {
      await settingsService.updateSettings({
        settings: { allow_stale_kiro_import: enabled ? 'true' : 'false' },
      });
      set({ allowStaleKiroImport: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
