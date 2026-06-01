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
  refreshIntervals: Record<string, number>
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
      allow_stale_kiro_import: String(this.runtime.allowStaleKiroImport),
    }
    for (const [platform, minutes] of Object.entries(this.runtime.refreshIntervals)) {
      kv[`refresh_interval_${platform}`] = String(minutes)
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
      else if (k === 'allow_stale_kiro_import') this.runtime.allowStaleKiroImport = v === 'true'
      else if (k.startsWith('refresh_interval_')) {
        const n = Number(v)
        const platform = k.slice('refresh_interval_'.length)
        if (Number.isInteger(n) && n >= 2 && n <= 30) this.runtime.refreshIntervals[platform] = n
      }
    }
  }
}
