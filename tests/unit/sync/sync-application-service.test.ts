import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

// P1-5 固化断言：WebDAV 密码不明文落库
//
// WebDAV 连接密码（webdavPassword）和 E2EE 同步密码（syncPassword）通过
// SafeStorageSecretStore（Electron safeStorage 加密文件）持久化，而非 settings.json。
// WebdavConfig.toJson() 的接口定义（WebdavConfigJson）中不含任何 password 字段，
// saveConfig() 的实现明确将两类密码路由到 SecretStore，绝不写入 settings 文件。
//
// 以下测试通过 settings.json 磁盘 round-trip 固化这一不变量，防止将来改动意外
// 把密码字段混入持久化产物。
describe('P1-5: WebDAV 密码不明文落库（settings.json round-trip 断言）', () => {
  // 辅助：读取磁盘上的 settings.json 原始文本
  function readDiskSettings(path: string): string {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }

  it('saveConfig 后 settings.json 不含任何明文密码字段（含 key 名和 value）', async () => {
    const settingsFile = new SettingsFileService(settingsPath)
    await settingsFile.load()
    const webdavStore = new MemSecret()
    const syncStore = new MemSecret()
    const svc = makeService(settingsFile, webdavStore, syncStore)

    const LOGIN_PW = 'super-secret-webdav-pw'
    const SYNC_PW = 'super-secret-sync-pw'

    await svc.saveConfig({
      config: WebdavConfig.fromJson({
        enabled: true,
        baseUrl: 'https://dav.example.com/dav',
        username: 'alice',
        remoteRoot: 'hxg-sync',
        profile: 'default',
        autoSync: true,
      }),
      password: LOGIN_PW,
      passwordTouched: true,
      syncPassword: SYNC_PW,
      syncPasswordTouched: true,
    })

    // 验证密码已写入 SecretStore（仅内存/文件，不在 settings.json）
    expect(await webdavStore.get()).toBe(LOGIN_PW)
    expect(await syncStore.get()).toBe(SYNC_PW)

    // 磁盘 round-trip：读取实际写入的 settings.json 原始文本
    const diskText = readDiskSettings(settingsPath)
    expect(diskText.length).toBeGreaterThan(0) // 文件确实写入了

    // 不含明文密码值
    expect(diskText).not.toContain(LOGIN_PW)
    expect(diskText).not.toContain(SYNC_PW)

    // 不含任何 password 相关 key 名（防止未来新增字段时漏检）
    const parsed = JSON.parse(diskText) as Record<string, unknown>
    const webdavBlock = JSON.stringify(parsed['webdav'] ?? {})
    expect(webdavBlock).not.toMatch(/password/i)
    expect(webdavBlock).not.toMatch(/passwd/i)
    expect(webdavBlock).not.toMatch(/secret/i)
  })

  it('WebdavConfig.toJson() 输出的 key 集合不含任何 password 字段', () => {
    // 纯静态断言：domain VO 的 JSON 契约不含密码 key。
    // 密码存储路径为 SafeStorageSecretStore（Electron safeStorage 加密文件），
    // 与 settings.json 完全隔离。
    const cfg = WebdavConfig.fromJson({
      enabled: true,
      baseUrl: 'https://dav.example.com',
      username: 'alice',
      remoteRoot: 'root',
      profile: 'default',
      autoSync: false,
    })
    const keys = Object.keys(cfg.toJson())
    const passwordKeys = keys.filter((k) => /password|passwd|secret/i.test(k))
    expect(passwordKeys).toHaveLength(0)
    // 确认合法 key 都在场（防止 toJson() 被意外清空）
    expect(keys).toContain('enabled')
    expect(keys).toContain('baseUrl')
    expect(keys).toContain('username')
    expect(keys).toContain('remoteRoot')
    expect(keys).toContain('profile')
    expect(keys).toContain('autoSync')
    expect(keys).toContain('status')
  })
})
