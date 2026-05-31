import { hostname } from 'node:os'
import type { SettingsFileService } from '../../settings/infrastructure/settings-file-service'
import type { SqlDatabase } from './config-port'
import type { WebDavClient } from '../domain/webdav-client'
import type { MasterKeyStore } from '../domain/master-key-store'
import type { SecretStore } from '../infrastructure/secret-store'
import { WebdavConfig, type WebdavConfigJson } from '../domain/webdav-config'
import {
  download as orchestrateDownload,
  fetchRemoteInfo as orchestrateFetchRemoteInfo,
  testConnection as orchestrateTestConnection,
  upload as orchestrateUpload,
  withSyncLock,
  type DownloadOutcome,
  type RemoteInfo,
  type SyncDeps,
} from './sync-service'

// SyncApplicationService — the use-case layer the IPC handlers call. Mirrors the
// source command layer (modules/sync/api.rs) which holds SyncState and the
// password-resolution + status-persistence logic around the pure orchestration
// in sync_service.rs.
//
// Responsibilities (matching api.rs exactly):
//   - getConfig():        return the in-memory settings.json webdav snapshot.
//   - testConnection():   resolve password (touched → incoming, else keychain)
//                         then PROPFIND + ensure dirs. Does NOT save config.
//   - saveConfig():       persist WebdavConfig to settings.json (preserving the
//                         backend-managed status); conditionally write/clear the
//                         WebDAV login + sync passwords in the secret stores per
//                         the *_touched flags. Passwords NEVER hit settings.json.
//   - syncUpload():       require enabled + non-empty sync password; run under the
//                         global lock; persist last_sync_at/etag on success or
//                         last_error(source='manual') on failure.
//   - syncDownload():     same guards/lock; returns needsRestart.
//   - fetchRemoteInfo():  manifest overview only (no artifact download).

/** Request shape for testConnection (camelCase top-level args from the frontend). */
export interface TestConnectionArgs {
  config: WebdavConfig
  password?: string
  passwordTouched: boolean
}

/** Request shape for saveConfig (camelCase top-level args from the frontend). */
export interface SaveConfigArgs {
  config: WebdavConfig
  password?: string
  passwordTouched: boolean
  syncPassword?: string
  syncPasswordTouched: boolean
}

export interface SyncApplicationDeps {
  settingsFile: SettingsFileService
  db: SqlDatabase
  client: WebDavClient
  masterKeyStore: MasterKeyStore
  /** WebDAV login password (source 'haoxiaoguan.webdav.password' keychain entry). */
  webdavPasswordStore: SecretStore
  /** E2EE sync password (source 'haoxiaoguan.sync.password' keychain entry). */
  syncPasswordStore: SecretStore
  /** SSOT skills root (defaults to ~/.haoxiaoguan/skills via container). */
  ssotRoot: string
  /** Device name provider (defaults to os.hostname()); injectable for tests. */
  deviceName?: () => string
  /** Unix-seconds clock (defaults to Date.now()); injectable for tests. */
  now?: () => number
}

/**
 * Resolve the password to use given the "touched" semantics (mirrors
 * api.rs::resolve_password):
 *   - touched=true:  use the incoming value (allows explicit clearing).
 *   - touched=false: ignore incoming, reuse the stored keychain value (→ '').
 */
export function resolvePassword(
  touched: boolean,
  incoming: string | undefined,
  existing: string | null,
): string {
  if (touched) {
    return incoming ?? ''
  }
  return existing ?? ''
}

export class SyncApplicationService {
  private readonly deviceName: () => string
  private readonly now: () => number

  constructor(private readonly deps: SyncApplicationDeps) {
    this.deviceName = deps.deviceName ?? (() => hostname() || 'unknown-device')
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  }

  /** Current WebdavConfig parsed from the settings.json webdav block. */
  getConfig(): WebdavConfig {
    return WebdavConfig.fromJson(this.snapshotWebdav())
  }

  /** PROPFIND + ensure remote directories. Does not save config. */
  async testConnection(args: TestConnectionArgs): Promise<void> {
    const existing = await this.deps.webdavPasswordStore.get()
    const webdavPassword = resolvePassword(args.passwordTouched, args.password, existing)
    const syncPassword = (await this.deps.syncPasswordStore.get()) ?? ''
    const deps = this.buildDeps(args.config, webdavPassword, syncPassword)
    await orchestrateTestConnection(deps)
  }

  /** Persist config + conditionally write/clear the two passwords. */
  async saveConfig(args: SaveConfigArgs): Promise<void> {
    // (1) WebDAV login password.
    if (args.passwordTouched) {
      const pw = args.password ?? ''
      if (pw.length === 0) {
        await this.deps.webdavPasswordStore.clear()
      } else {
        await this.deps.webdavPasswordStore.set(pw)
      }
    }
    // (2) Sync password.
    if (args.syncPasswordTouched) {
      const pw = args.syncPassword ?? ''
      if (pw.length === 0) {
        await this.deps.syncPasswordStore.clear()
      } else {
        await this.deps.syncPasswordStore.set(pw)
      }
    }
    // (3) Persist config but preserve the existing (backend-managed) status.
    const existing = WebdavConfig.fromJson(this.snapshotWebdav())
    await this.deps.settingsFile.mutate((s) => {
      const toSave = args.config.toJson()
      toSave.status = existing.status.toJson()
      s.webdav = toSave as unknown as Record<string, unknown>
    })
  }

  /** Immediate upload under the global lock; persists status. */
  async syncUpload(): Promise<{ status: 'uploaded' }> {
    const config = WebdavConfig.fromJson(this.snapshotWebdav())
    if (!config.enabled) {
      throw new Error('WebDAV 同步未启用')
    }
    const syncPassword = (await this.deps.syncPasswordStore.get()) ?? ''
    if (syncPassword.length === 0) {
      throw new Error('同步密码未设置，请先在同步设置中配置')
    }
    const webdavPassword = (await this.deps.webdavPasswordStore.get()) ?? ''
    const deps = this.buildDeps(config, webdavPassword, syncPassword)

    return withSyncLock(async () => {
      try {
        const outcome = await orchestrateUpload(deps)
        await this.persistSuccess(outcome.manifestEtag)
        return { status: 'uploaded' as const }
      } catch (e) {
        await this.persistError(e, 'manual')
        throw e
      }
    })
  }

  /** Immediate download+apply under the global lock; persists status. */
  async syncDownload(): Promise<{ status: 'downloaded'; needsRestart: boolean }> {
    const config = WebdavConfig.fromJson(this.snapshotWebdav())
    if (!config.enabled) {
      throw new Error('WebDAV 同步未启用')
    }
    const syncPassword = (await this.deps.syncPasswordStore.get()) ?? ''
    if (syncPassword.length === 0) {
      throw new Error('同步密码未设置，请先在同步设置中配置')
    }
    const webdavPassword = (await this.deps.webdavPasswordStore.get()) ?? ''
    const deps = this.buildDeps(config, webdavPassword, syncPassword)

    return withSyncLock(async () => {
      try {
        const outcome: DownloadOutcome = await orchestrateDownload(deps)
        await this.persistSuccess(outcome.manifestEtag)
        return { status: 'downloaded' as const, needsRestart: outcome.needsRestart }
      } catch (e) {
        await this.persistError(e, 'manual')
        throw e
      }
    })
  }

  /** Remote manifest overview (no artifact download, no lock). */
  async fetchRemoteInfo(): Promise<RemoteInfo> {
    const config = WebdavConfig.fromJson(this.snapshotWebdav())
    const webdavPassword = (await this.deps.webdavPasswordStore.get()) ?? ''
    const syncPassword = (await this.deps.syncPasswordStore.get()) ?? ''
    const deps = this.buildDeps(config, webdavPassword, syncPassword)
    return orchestrateFetchRemoteInfo(deps)
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private snapshotWebdav(): WebdavConfigJson {
    return this.deps.settingsFile.snapshot().webdav as WebdavConfigJson
  }

  private buildDeps(
    config: WebdavConfig,
    webdavPassword: string,
    syncPassword: string,
  ): SyncDeps {
    return {
      db: this.deps.db,
      client: this.deps.client,
      masterKeyStore: this.deps.masterKeyStore,
      ssotRoot: this.deps.ssotRoot,
      config,
      webdavPassword,
      syncPassword,
      deviceName: this.deviceName(),
      nowTs: this.now(),
    }
  }

  /** Write last_sync_at + etag, clear last_error/source. */
  private async persistSuccess(etag: string | null): Promise<void> {
    const ts = this.now()
    await this.deps.settingsFile.mutate((s) => {
      const cfg = WebdavConfig.fromJson(s.webdav as WebdavConfigJson)
      cfg.status.lastSyncAt = ts
      cfg.status.lastError = null
      cfg.status.lastErrorSource = null
      if (etag != null) {
        cfg.status.lastRemoteEtag = etag
      }
      s.webdav = cfg.toJson() as unknown as Record<string, unknown>
    })
  }

  /** Write last_error + source on failure. */
  private async persistError(err: unknown, source: 'manual' | 'auto'): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err)
    await this.deps.settingsFile.mutate((s) => {
      const cfg = WebdavConfig.fromJson(s.webdav as WebdavConfigJson)
      cfg.status.lastError = msg
      cfg.status.lastErrorSource = source
      s.webdav = cfg.toJson() as unknown as Record<string, unknown>
    })
  }
}
