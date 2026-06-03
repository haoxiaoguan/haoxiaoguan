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
  // 本地 AI API 反代服务（apiProxy 上下文）是否随应用就绪自启。默认 false：
  // 尊重用户在「API 服务」页的开关，不强制自启。
  apiProxyEnabled: boolean
  // 反代服务监听端口（127.0.0.1）。默认 8788；被占用时 ApiHttpServer 自动回退 +1。
  apiProxyPort: number
  // 客户端 API Key（明文，M2b 简单版；加密多 Key 实体留 M5）。默认 []：未配置鉴权。
  // 客户端经 Authorization: Bearer / x-api-key / x-goog-api-key / ?key= 之一携带。
  apiProxyClientKeys: string[]
  // 为 true 时本机回环（127.0.0.1/::1）在未配置 Key 情况下免鉴权，便于本地直连。默认 true。
  apiProxyAllowAnonymousLoopback: boolean
  // M4 账号池/选择/故障转移/健康参数。
  apiProxySelectionStrategy: 'sticky-lru' | 'round-robin'
  apiProxyAffinityTtlMs: number
  apiProxyPerAccountConcurrency: number
  apiProxyMaxRetries: number
  apiProxyRetryDelayMs: number
  apiProxyBaseCooldownMs: number
  apiProxyMaxBackoffMultiplier: number
  apiProxyQuotaResetMs: number
  apiProxyProbabilisticRetryChance: number
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
  apiProxyEnabled: false,
  apiProxyPort: 8788,
  apiProxyClientKeys: [],
  apiProxyAllowAnonymousLoopback: true,
  apiProxySelectionStrategy: 'sticky-lru',
  apiProxyAffinityTtlMs: 600000,
  apiProxyPerAccountConcurrency: 4,
  apiProxyMaxRetries: 3,
  apiProxyRetryDelayMs: 100,
  apiProxyBaseCooldownMs: 1000,
  apiProxyMaxBackoffMultiplier: 64,
  apiProxyQuotaResetMs: 3600000,
  apiProxyProbabilisticRetryChance: 0.1,
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
    runtime.apiProxyClientKeys = Array.isArray(raw.runtime?.apiProxyClientKeys)
      ? raw.runtime.apiProxyClientKeys.filter((k: unknown): k is string => typeof k === 'string')
      : []
    if (raw.runtime?.apiProxySelectionStrategy !== 'sticky-lru' && raw.runtime?.apiProxySelectionStrategy !== 'round-robin') {
      runtime.apiProxySelectionStrategy = 'sticky-lru'
    }
    if (!Number.isInteger(runtime.apiProxyMaxRetries) || runtime.apiProxyMaxRetries < 1) runtime.apiProxyMaxRetries = 3
    if (!Number.isInteger(runtime.apiProxyPerAccountConcurrency) || runtime.apiProxyPerAccountConcurrency < 1) runtime.apiProxyPerAccountConcurrency = 4
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
      api_proxy_enabled: String(this.runtime.apiProxyEnabled),
      api_proxy_port: String(this.runtime.apiProxyPort),
      api_proxy_client_keys: this.runtime.apiProxyClientKeys.join('\n'),
      api_proxy_allow_anonymous_loopback: String(this.runtime.apiProxyAllowAnonymousLoopback),
      api_proxy_selection_strategy: this.runtime.apiProxySelectionStrategy,
      api_proxy_affinity_ttl_ms: String(this.runtime.apiProxyAffinityTtlMs),
      api_proxy_per_account_concurrency: String(this.runtime.apiProxyPerAccountConcurrency),
      api_proxy_max_retries: String(this.runtime.apiProxyMaxRetries),
      api_proxy_retry_delay_ms: String(this.runtime.apiProxyRetryDelayMs),
      api_proxy_base_cooldown_ms: String(this.runtime.apiProxyBaseCooldownMs),
      api_proxy_max_backoff_multiplier: String(this.runtime.apiProxyMaxBackoffMultiplier),
      api_proxy_quota_reset_ms: String(this.runtime.apiProxyQuotaResetMs),
      api_proxy_probabilistic_retry_chance: String(this.runtime.apiProxyProbabilisticRetryChance),
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
      else if (k === 'api_proxy_enabled') this.runtime.apiProxyEnabled = v === 'true'
      else if (k === 'api_proxy_port') {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1024 && n <= 65535) this.runtime.apiProxyPort = n
      } else if (k === 'api_proxy_client_keys') {
        // 空串 → 清空；否则按换行拆分、去空白、丢空行。
        this.runtime.apiProxyClientKeys = v
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      } else if (k === 'api_proxy_allow_anonymous_loopback') {
        this.runtime.apiProxyAllowAnonymousLoopback = v === 'true'
      } else if (k === 'api_proxy_selection_strategy') {
        if (v === 'sticky-lru' || v === 'round-robin') this.runtime.apiProxySelectionStrategy = v
      } else if (k === 'api_proxy_affinity_ttl_ms') {
        const n = Number(v); if (Number.isInteger(n) && n >= 0) this.runtime.apiProxyAffinityTtlMs = n
      } else if (k === 'api_proxy_per_account_concurrency') {
        const n = Number(v); if (Number.isInteger(n) && n >= 1) this.runtime.apiProxyPerAccountConcurrency = n
      } else if (k === 'api_proxy_max_retries') {
        const n = Number(v); if (Number.isInteger(n) && n >= 1) this.runtime.apiProxyMaxRetries = n
      } else if (k === 'api_proxy_retry_delay_ms') {
        const n = Number(v); if (Number.isInteger(n) && n >= 0) this.runtime.apiProxyRetryDelayMs = n
      } else if (k === 'api_proxy_base_cooldown_ms') {
        const n = Number(v); if (Number.isInteger(n) && n >= 0) this.runtime.apiProxyBaseCooldownMs = n
      } else if (k === 'api_proxy_max_backoff_multiplier') {
        const n = Number(v); if (Number.isInteger(n) && n >= 1) this.runtime.apiProxyMaxBackoffMultiplier = n
      } else if (k === 'api_proxy_quota_reset_ms') {
        const n = Number(v); if (Number.isInteger(n) && n >= 0) this.runtime.apiProxyQuotaResetMs = n
      } else if (k === 'api_proxy_probabilistic_retry_chance') {
        const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1) this.runtime.apiProxyProbabilisticRetryChance = n
      } else if (k.startsWith('refresh_interval_')) {
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
