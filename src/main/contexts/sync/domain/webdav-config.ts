// WebdavConfig + WebdavStatus value objects — mirror source
// modules/settings/domain/app_settings.rs (the WebDAV section).
//
// These live in the sync context because sync owns the WebDAV protocol, but the
// JSON shape MUST match what the settings.json `webdav` block stores (camelCase)
// and what the frontend sends/receives verbatim. Passwords are NOT fields here —
// they live in the OS keychain / safeStorage, never in settings.json.
//
// Rich VO: fromJson applies serde-style defaults for missing keys; validation
// (baseUrl scheme) is exposed but only enforced where the source enforced it
// (URL building), matching the source's lenient save behavior.

export interface WebdavStatusJson {
  lastSyncAt?: number | null
  lastError?: string | null
  lastErrorSource?: string | null
  lastRemoteEtag?: string | null
}

/** Backend-managed sync status. The frontend treats this as read-only. */
export class WebdavStatus {
  lastSyncAt: number | null
  lastError: string | null
  lastErrorSource: 'manual' | 'auto' | null
  lastRemoteEtag: string | null

  constructor(init: WebdavStatusJson = {}) {
    this.lastSyncAt = init.lastSyncAt ?? null
    this.lastError = init.lastError ?? null
    this.lastErrorSource =
      init.lastErrorSource === 'manual' || init.lastErrorSource === 'auto'
        ? init.lastErrorSource
        : null
    this.lastRemoteEtag = init.lastRemoteEtag ?? null
  }

  toJson(): WebdavStatusJson {
    return {
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      lastErrorSource: this.lastErrorSource,
      lastRemoteEtag: this.lastRemoteEtag,
    }
  }
}

export interface WebdavConfigJson {
  enabled?: boolean
  baseUrl?: string
  username?: string
  remoteRoot?: string
  profile?: string
  autoSync?: boolean
  status?: WebdavStatusJson
}

const DEFAULT_REMOTE_ROOT = 'haoxiaoguan-sync'
const DEFAULT_PROFILE = 'default'

/**
 * WebDAV sync configuration (no passwords). Default factory 对应
 * `WebdavConfig::default()` (`enabled=false`, `remoteRoot='haoxiaoguan-sync'`,
 * `profile='default'`).
 */
export class WebdavConfig {
  enabled: boolean
  baseUrl: string
  username: string
  remoteRoot: string
  profile: string
  autoSync: boolean
  status: WebdavStatus

  private constructor(
    enabled: boolean,
    baseUrl: string,
    username: string,
    remoteRoot: string,
    profile: string,
    autoSync: boolean,
    status: WebdavStatus,
  ) {
    this.enabled = enabled
    this.baseUrl = baseUrl
    this.username = username
    this.remoteRoot = remoteRoot
    this.profile = profile
    this.autoSync = autoSync
    this.status = status
  }

  /** serde(default)-equivalent parse: missing keys fall back to defaults. */
  static fromJson(raw: WebdavConfigJson | null | undefined): WebdavConfig {
    const r = raw ?? {}
    return new WebdavConfig(
      r.enabled ?? false,
      r.baseUrl ?? '',
      r.username ?? '',
      r.remoteRoot ?? DEFAULT_REMOTE_ROOT,
      r.profile ?? DEFAULT_PROFILE,
      r.autoSync ?? false,
      new WebdavStatus(r.status ?? {}),
    )
  }

  static default(): WebdavConfig {
    return WebdavConfig.fromJson({})
  }

  /** camelCase JSON for settings.json persistence + frontend round-trips. */
  toJson(): Required<Omit<WebdavConfigJson, 'status'>> & { status: WebdavStatusJson } {
    return {
      enabled: this.enabled,
      baseUrl: this.baseUrl,
      username: this.username,
      remoteRoot: this.remoteRoot,
      profile: this.profile,
      autoSync: this.autoSync,
      status: this.status.toJson(),
    }
  }

  /** Invariant check used by URL building (baseUrl must be http(s)). */
  assertValidBaseUrl(): void {
    const base = this.baseUrl.trim()
    if (base.length === 0) {
      throw new Error('WebDAV base_url 为空')
    }
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      throw new Error(`WebDAV base_url 必须以 http:// 或 https:// 开头: ${base}`)
    }
  }
}
