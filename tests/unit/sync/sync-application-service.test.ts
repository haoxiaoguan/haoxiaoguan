import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsFileService } from '../../../src/main/contexts/settings/infrastructure/settings-file-service'
import {
  SyncApplicationService,
  resolvePassword,
  type SyncApplicationDeps,
} from '../../../src/main/contexts/sync/application/sync-application-service'
import type { SecretStore } from '../../../src/main/contexts/sync/infrastructure/secret-store'
import { WebdavConfig } from '../../../src/main/contexts/sync/domain/webdav-config'
import type { WebDavClient, WebDavAuth } from '../../../src/main/contexts/sync/domain/webdav-client'
import type { MasterKeyStore } from '../../../src/main/contexts/sync/domain/master-key-store'
import type { SqlDatabase, SqlTx } from '../../../src/main/contexts/sync/application/config-port'

// In-memory secret store (the safeStorage-backed one needs Electron + files).
class MemSecret implements SecretStore {
  constructor(private value: string | null = null) {}
  async get(): Promise<string | null> {
    return this.value
  }
  async set(value: string): Promise<void> {
    this.value = value
  }
  async clear(): Promise<void> {
    this.value = null
  }
}

// Minimal fakes for deps we don't exercise in these tests.
const noopClient: WebDavClient = {
  async testConnection(): Promise<void> {},
  async ensureRemoteDirectories(): Promise<void> {},
  async putBytes(): Promise<void> {},
  async getBytes(): Promise<{ bytes: Buffer; etag: string | null } | null> {
    return null
  },
  async headEtag(_url: string, _auth: WebDavAuth): Promise<string | null> {
    return null
  },
}
const noopKeyStore: MasterKeyStore = {
  async load(): Promise<Buffer> {
    return Buffer.alloc(32, 1)
  },
  async store(): Promise<void> {},
}
const noopDb: SqlDatabase = {
  async all(): Promise<never[]> {
    return []
  },
  async run(): Promise<void> {},
  async begin(): Promise<SqlTx> {
    return { async run() {}, async commit() {}, async rollback() {} }
  },
}

let tmp: string
let settingsPath: string

function makeService(
  settingsFile: SettingsFileService,
  webdavStore: SecretStore,
  syncStore: SecretStore,
  overrides: Partial<SyncApplicationDeps> = {},
): SyncApplicationService {
  return new SyncApplicationService({
    settingsFile,
    db: noopDb,
    client: noopClient,
    masterKeyStore: noopKeyStore,
    webdavPasswordStore: webdavStore,
    syncPasswordStore: syncStore,
    ssotRoot: join(tmp, 'skills'),
    deviceName: () => 'unit-device',
    now: () => 1_730_000_000,
    ...overrides,
  })
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hxg-sync-app-'))
  settingsPath = join(tmp, 'settings.json')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('resolvePassword', () => {
  it('touched=true uses the incoming value', () => {
    expect(resolvePassword(true, 'new-pw', 'old-pw')).toBe('new-pw')
  })
  it('touched=true with empty clears (returns empty)', () => {
    expect(resolvePassword(true, '', 'old-pw')).toBe('')
  })
  it('touched=false reuses the existing value', () => {
    expect(resolvePassword(false, 'ignored', 'old-pw')).toBe('old-pw')
  })
  it('touched=false with no existing yields empty', () => {
    expect(resolvePassword(false, 'ignored', null)).toBe('')
  })
})

describe('SyncApplicationService.saveConfig', () => {
  it('persists config to settings.json without password fields, preserving status', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    // Seed an existing backend-managed status.
    await settingsFile.mutate((s) => {
      s.webdav = WebdavConfig.fromJson({ status: { lastSyncAt: 555 } }).toJson() as Record<
        string,
        unknown
      >
    })

    const webdavStore = new MemSecret()
    const syncStore = new MemSecret()
    const svc = makeService(settingsFile, webdavStore, syncStore)

    await svc.saveConfig({
      config: WebdavConfig.fromJson({
        enabled: true,
        baseUrl: 'https://h/dav',
        username: 'alice',
      }),
      password: 'login-pw',
      passwordTouched: true,
      syncPassword: 'e2ee-pw',
      syncPasswordTouched: true,
    })

    const saved = svc.getConfig()
    expect(saved.enabled).toBe(true)
    expect(saved.baseUrl).toBe('https://h/dav')
    // status preserved (not overwritten by save).
    expect(saved.status.lastSyncAt).toBe(555)
    // Passwords went to the stores, never settings.json.
    expect(await webdavStore.get()).toBe('login-pw')
    expect(await syncStore.get()).toBe('e2ee-pw')
    const persisted = JSON.stringify(settingsFile.snapshot().toJson())
    expect(persisted).not.toContain('login-pw')
    expect(persisted).not.toContain('e2ee-pw')
  })

  it('clears a password when touched with an empty value', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    const webdavStore = new MemSecret('existing-login')
    const syncStore = new MemSecret('existing-sync')
    const svc = makeService(settingsFile, webdavStore, syncStore)

    await svc.saveConfig({
      config: WebdavConfig.fromJson({ enabled: false }),
      password: '',
      passwordTouched: true,
      syncPassword: undefined,
      syncPasswordTouched: false, // not touched → keep existing
    })

    expect(await webdavStore.get()).toBeNull() // cleared
    expect(await syncStore.get()).toBe('existing-sync') // preserved
  })

  it('does not touch passwords when *Touched is false', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    const webdavStore = new MemSecret('keep-login')
    const syncStore = new MemSecret('keep-sync')
    const svc = makeService(settingsFile, webdavStore, syncStore)

    await svc.saveConfig({
      config: WebdavConfig.fromJson({ enabled: true, baseUrl: 'https://h/dav' }),
      password: 'should-be-ignored',
      passwordTouched: false,
      syncPassword: 'should-be-ignored',
      syncPasswordTouched: false,
    })

    expect(await webdavStore.get()).toBe('keep-login')
    expect(await syncStore.get()).toBe('keep-sync')
  })
})

describe('SyncApplicationService guards + status', () => {
  it('syncUpload rejects when sync is disabled', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    await settingsFile.mutate((s) => {
      s.webdav = WebdavConfig.fromJson({ enabled: false }).toJson() as Record<string, unknown>
    })
    const svc = makeService(settingsFile, new MemSecret('l'), new MemSecret('s'))
    await expect(svc.syncUpload()).rejects.toThrow('WebDAV 同步未启用')
  })

  it('syncUpload rejects when the sync password is empty', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    await settingsFile.mutate((s) => {
      s.webdav = WebdavConfig.fromJson({ enabled: true, baseUrl: 'https://h/dav' }).toJson() as Record<
        string,
        unknown
      >
    })
    const svc = makeService(settingsFile, new MemSecret('l'), new MemSecret(null))
    await expect(svc.syncUpload()).rejects.toThrow('同步密码未设置')
  })

  it('writes last_error + source=manual when upload fails', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    await settingsFile.mutate((s) => {
      s.webdav = WebdavConfig.fromJson({
        enabled: true,
        baseUrl: 'https://h/dav',
        username: 'alice',
      }).toJson() as Record<string, unknown>
    })

    // Client that fails ensureRemoteDirectories → upload throws.
    const failingClient: WebDavClient = {
      ...noopClient,
      async ensureRemoteDirectories(): Promise<void> {
        throw new Error('boom')
      },
    }
    const svc = makeService(
      settingsFile,
      new MemSecret('login'),
      new MemSecret('sync-pw'),
      { client: failingClient },
    )

    await expect(svc.syncUpload()).rejects.toBeTruthy()
    const cfg = svc.getConfig()
    expect(cfg.status.lastError).toBeTruthy()
    expect(cfg.status.lastErrorSource).toBe('manual')
  }, 30_000)
})
