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
  /** Per-platform whole-platform batch refresh intervals in minutes (0 = off) */
  platformRefreshIntervals: Map<PlatformId, number>;
  /** Per-platform app/IDE launch path */
  idePaths: Record<string, string>;
  /** Max accounts refreshed in parallel during a batch sweep (global, 1–10) */
  quotaRefreshConcurrency: number;
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
  /** 「会话」恢复用的终端启动命令模板，占位符 {cwd}/{command}。空串=未配置（前端降级为复制）。 */
  terminalLaunchTemplate: string;
  /** Codex「中转注入」(L2 真共存) 开关。 */
  codexRelayInjectionEnabled: boolean;
  /** 切换 Codex 账号后自动重启/拉起 Codex App（停-写-启，默认开）。 */
  codexLaunchOnSwitch: boolean;
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
  /** Update whole-platform batch refresh interval (minutes; 0 disables) */
  setPlatformRefreshInterval: (platform: PlatformId, minutes: number) => Promise<void>;
  /** Update the app/IDE launch path for a platform */
  setIdePath: (platform: PlatformId, path: string) => Promise<void>;
  /** Update the global batch-sweep concurrency (1–100) */
  setQuotaRefreshConcurrency: (count: number) => Promise<void>;
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
  /** Update terminal launch template (for session resume) */
  setTerminalLaunchTemplate: (template: string) => Promise<void>;
  /** Update Codex 中转注入 (L2) toggle */
  setCodexRelayInjectionEnabled: (enabled: boolean) => Promise<void>;
  /** Update 切换 Codex 账号后自动启动 App toggle */
  setCodexLaunchOnSwitch: (enabled: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'system',
  language: 'en',
  refreshIntervals: new Map(),
  platformRefreshIntervals: new Map(),
  idePaths: {},
  quotaRefreshConcurrency: 3,
  closeBehavior: 'minimize',
  wsPort: 19528,
  silentStart: false,
  autostart: false,
  utilityButtons: 'device,support,docs,notification',
  allowStaleKiroImport: false,
  terminalLaunchTemplate: '',
  codexRelayInjectionEnabled: false,
  codexLaunchOnSwitch: true,
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
      const platformRefreshIntervals = new Map<PlatformId, number>();
      for (const [key, value] of Object.entries(settings.platformRefreshIntervals ?? {})) {
        platformRefreshIntervals.set(key as PlatformId, value);
      }
      set({
        theme: settings.theme as ThemeMode,
        language: settings.language,
        closeBehavior: settings.closeBehavior as CloseWindowBehavior,
        wsPort: settings.wsPort,
        refreshIntervals,
        platformRefreshIntervals,
        idePaths: settings.idePaths ?? {},
        quotaRefreshConcurrency: settings.quotaRefreshConcurrency ?? 3,
        silentStart: settings.silentStart,
        autostart: settings.autostart,
        utilityButtons: settings.utilityButtons,
        allowStaleKiroImport: settings.allowStaleKiroImport,
        terminalLaunchTemplate: settings.terminalLaunchTemplate ?? '',
        codexRelayInjectionEnabled: settings.codexRelayInjectionEnabled ?? false,
        codexLaunchOnSwitch: settings.codexLaunchOnSwitch ?? true,
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

  setPlatformRefreshInterval: async (platform: PlatformId, minutes: number) => {
    try {
      await settingsService.updateSettings({
        settings: { [`platform_refresh_interval_${platform}`]: String(minutes) },
      });
      const platformRefreshIntervals = new Map(get().platformRefreshIntervals);
      platformRefreshIntervals.set(platform, minutes);
      set({ platformRefreshIntervals });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setIdePath: async (platform: PlatformId, path: string) => {
    try {
      await settingsService.updateSettings({
        settings: { [`ide_path_${platform}`]: path },
      });
      const idePaths = { ...get().idePaths };
      if (path.trim().length > 0) idePaths[platform] = path;
      else delete idePaths[platform];
      set({ idePaths });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setQuotaRefreshConcurrency: async (count: number) => {
    const clamped = Math.min(100, Math.max(1, Math.round(count)));
    try {
      await settingsService.updateSettings({
        settings: { quota_refresh_concurrency: String(clamped) },
      });
      set({ quotaRefreshConcurrency: clamped });
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

  setTerminalLaunchTemplate: async (template: string) => {
    try {
      await settingsService.updateSettings({ settings: { terminal_launch_template: template } });
      set({ terminalLaunchTemplate: template });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setCodexRelayInjectionEnabled: async (enabled: boolean) => {
    try {
      await settingsService.updateSettings({ settings: { codex_relay_injection_enabled: enabled ? 'true' : 'false' } });
      set({ codexRelayInjectionEnabled: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setCodexLaunchOnSwitch: async (enabled: boolean) => {
    try {
      await settingsService.updateSettings({ settings: { codex_launch_on_switch: enabled ? 'true' : 'false' } });
      set({ codexLaunchOnSwitch: enabled });
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
