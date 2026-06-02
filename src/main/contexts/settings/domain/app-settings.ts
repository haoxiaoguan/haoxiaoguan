export type ThemeMode = 'light' | 'dark' | 'system'
export type CloseBehavior = 'quit' | 'minimize'

export interface UiSettings {
  theme: ThemeMode
  language: string
  closeBehavior: CloseBehavior
  utilityButtons: string
}

export interface RuntimeSettings {
  wsPort: number
  silentStart: boolean
  autostart: boolean
  // Active-account quota refresh interval per platform, in minutes (2–30). The
  // active account is the one currently in use in the app/IDE.
  refreshIntervals: Record<string, number>
  // Whole-platform batch quota refresh interval per platform, in minutes. 0
  // means disabled (default), otherwise 10–240. Drives PlatformQuotaScheduler's
  // batch sweep over every account of that platform.
  platformRefreshIntervals: Record<string, number>
  // app/IDE launch path per platform (absolute path to the executable/.app).
  idePaths: Record<string, string>
  // Max number of accounts refreshed in parallel during a whole-platform batch
  // sweep. Global (shared across platforms). Default 3, range 1–100.
  quotaRefreshConcurrency: number
  // When true, Kiro accounts import even when their identity cannot be confirmed
  // online (degraded to a placeholder, never the stale local identity). Default
  // false: import is blocked until a live getUsageLimits succeeds.
  allowStaleKiroImport: boolean
}

const UI_DEFAULTS: UiSettings = {
  theme: 'system',
  language: 'zh-CN',
  closeBehavior: 'minimize',
  utilityButtons: 'device,support,docs,notification',
}

const RUNTIME_DEFAULTS: RuntimeSettings = {
  wsPort: 9876,
  silentStart: false,
  autostart: false,
  refreshIntervals: {},
  platformRefreshIntervals: {},
  idePaths: {},
  quotaRefreshConcurrency: 3,
  allowStaleKiroImport: false,
}

export class AppSettings {
  ui: UiSettings
  runtime: RuntimeSettings
  webdav: Record<string, unknown>
  localBackup: Record<string, unknown>

  private constructor(
    ui: UiSettings,
    runtime: RuntimeSettings,
    webdav: Record<string, unknown>,
    localBackup: Record<string, unknown>,
  ) {
    this.ui = ui
    this.runtime = runtime
    this.webdav = webdav
    this.localBackup = localBackup
  }

  static fromJson(raw: Record<string, any>): AppSettings {
    const ui = { ...UI_DEFAULTS, ...(raw.ui ?? {}) }
    const runtime = { ...RUNTIME_DEFAULTS, ...(raw.runtime ?? {}) }
    runtime.refreshIntervals = { ...(raw.runtime?.refreshIntervals ?? {}) }
    runtime.platformRefreshIntervals = { ...(raw.runtime?.platformRefreshIntervals ?? {}) }
    runtime.idePaths = { ...(raw.runtime?.idePaths ?? {}) }
    return new AppSettings(ui, runtime, raw.webdav ?? {}, raw.localBackup ?? {})
  }

  toJson(): Record<string, unknown> {
    return { ui: this.ui, runtime: this.runtime, webdav: this.webdav, localBackup: this.localBackup }
  }

  // Flat KV projection consumed by get_settings / produced by update_settings.
  // Keys are snake_case; per-platform refresh uses refresh_interval_<PlatformKey>.
  toFlatKv(): Record<string, string> {
    const kv: Record<string, string> = {
      theme: this.ui.theme,
      language: this.ui.language,
      close_behavior: this.ui.closeBehavior,
      utility_buttons: this.ui.utilityButtons,
      ws_port: String(this.runtime.wsPort),
      silent_start: String(this.runtime.silentStart),
      autostart: String(this.runtime.autostart),
      quota_refresh_concurrency: String(this.runtime.quotaRefreshConcurrency),
      allow_stale_kiro_import: String(this.runtime.allowStaleKiroImport),
    }
    for (const [platform, minutes] of Object.entries(this.runtime.refreshIntervals)) {
      kv[`refresh_interval_${platform}`] = String(minutes)
    }
    for (const [platform, minutes] of Object.entries(this.runtime.platformRefreshIntervals)) {
      kv[`platform_refresh_interval_${platform}`] = String(minutes)
    }
    for (const [platform, path] of Object.entries(this.runtime.idePaths)) {
      kv[`ide_path_${platform}`] = path
    }
    return kv
  }

  // Lenient batch update (matches source: invalid values silently dropped).
  applyFlatKv(kv: Record<string, string>): void {
    for (const [k, v] of Object.entries(kv)) {
      if (k === 'theme' && (v === 'light' || v === 'dark' || v === 'system')) this.ui.theme = v
      else if (k === 'language' && v.trim().length > 0) this.ui.language = v
      else if (k === 'close_behavior' && (v === 'quit' || v === 'minimize')) this.ui.closeBehavior = v
      else if (k === 'utility_buttons') this.ui.utilityButtons = v
      else if (k === 'ws_port') {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1024) this.runtime.wsPort = n
      } else if (k === 'silent_start') this.runtime.silentStart = v === 'true'
      else if (k === 'autostart') this.runtime.autostart = v === 'true'
      else if (k === 'quota_refresh_concurrency') {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1 && n <= 100) this.runtime.quotaRefreshConcurrency = n
      } else if (k === 'allow_stale_kiro_import') this.runtime.allowStaleKiroImport = v === 'true'
      else if (k.startsWith('refresh_interval_')) {
        const n = Number(v)
        const platform = k.slice('refresh_interval_'.length)
        if (Number.isInteger(n) && n >= 2 && n <= 30) this.runtime.refreshIntervals[platform] = n
      } else if (k.startsWith('platform_refresh_interval_')) {
        const n = Number(v)
        const platform = k.slice('platform_refresh_interval_'.length)
        // 0 disables the batch sweep; otherwise 10–240 minutes.
        if (Number.isInteger(n) && (n === 0 || (n >= 10 && n <= 240))) {
          this.runtime.platformRefreshIntervals[platform] = n
        }
      } else if (k.startsWith('ide_path_')) {
        const platform = k.slice('ide_path_'.length)
        const path = v.trim()
        // Empty clears the path; non-empty stores it.
        if (path.length > 0) this.runtime.idePaths[platform] = path
        else delete this.runtime.idePaths[platform]
      }
    }
  }
}
