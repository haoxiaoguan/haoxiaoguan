import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { McpServerEntity } from '../../../src/main/contexts/mcp/infrastructure/mcp-server.entity'
import { MikroOrmSqlDatabase } from '../../../src/main/contexts/sync/infrastructure/mikro-orm-sql-database'
import {
  upload,
  download,
  fetchRemoteInfo,
  type SyncDeps,
} from '../../../src/main/contexts/sync/application/sync-service'
import { WebdavConfig } from '../../../src/main/contexts/sync/domain/webdav-config'
import type { WebDavClient, WebDavAuth } from '../../../src/main/contexts/sync/domain/webdav-client'
import type { MasterKeyStore } from '../../../src/main/contexts/sync/domain/master-key-store'
import { SyncError } from '../../../src/main/contexts/sync/domain/sync-error'

// End-to-end orchestration over fakes — 对应 sync_service tests
// (upload_then_download_roundtrip etc.). A HashMap-backed WebDAV fake stands in
// for the remote; in-memory MasterKeyStore + real in-memory SQLite for the DB.

class MemWebDav implements WebDavClient {
  files = new Map<string, Buffer>()
  async testConnection(): Promise<void> {}
  async ensureRemoteDirectories(): Promise<void> {}
  async putBytes(url: string, _auth: WebDavAuth, bytes: Buffer): Promise<void> {
    this.files.set(url, Buffer.from(bytes))
  }
  async getBytes(
    url: string,
    _auth: WebDavAuth,
    maxBytes: number,
  ): Promise<{ bytes: Buffer; etag: string | null } | null> {
    const b = this.files.get(url)
    if (!b) return null
    if (b.length > maxBytes) throw SyncError.integrity('超过上限')
    return { bytes: b, etag: '"etag"' }
  }
  async headEtag(url: string): Promise<string | null> {
    return this.files.has(url) ? '"etag"' : null
  }
}

class MemKeyStore implements MasterKeyStore {
  constructor(private key: Buffer) {}
  async load(): Promise<Buffer> {
    return Buffer.from(this.key)
  }
  async store(key: Buffer): Promise<void> {
    this.key = Buffer.from(key)
  }
}

function config(): WebdavConfig {
  return WebdavConfig.fromJson({
    enabled: true,
    baseUrl: 'https://dav.example.com/dav',
    username: 'alice',
    remoteRoot: 'root',
    profile: 'default',
    autoSync: false,
  })
}

let tmp: string

async function makeDb(): Promise<{
  orm: MikroORM
  db: MikroOrmSqlDatabase
  getEm: () => EntityManager
}> {
  const orm = await MikroORM.init({
    driver: (await import('@mikro-orm/better-sqlite')).SqliteDriver,
    dbName: ':memory:',
    entities: [McpServerEntity],
    allowGlobalContext: true,
  })
  await orm.getSchemaGenerator().createSchema()
  const getEm = () => orm.em.fork()
  return { orm, db: new MikroOrmSqlDatabase(getEm), getEm }
}

async function insertServer(getEm: () => EntityManager, id: string): Promise<void> {
  const now = 1700000000
  await getEm()
    .getConnection()
    .execute(
      `INSERT INTO mcp_servers
        (id, name, description, server_json, apps_json, homepage, docs, tags_json,
         created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 'Test', null, '{}', '{}', null, null, '[]', now, now, 0],
    )
}

function deps(
  db: MikroOrmSqlDatabase,
  client: WebDavClient,
  store: MasterKeyStore,
  ssotRoot: string,
  syncPassword = 'sync-pw-correct',
): SyncDeps {
  return {
    db,
    client,
    masterKeyStore: store,
    ssotRoot,
    config: config(),
    webdavPassword: 'dav-pw',
    syncPassword,
    deviceName: 'test-device',
    nowTs: 1_730_000_000,
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hxg-sync-svc-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('sync-service orchestration', () => {
  it('upload then download round-trips db + skills + master key', async () => {
    const webdav = new MemWebDav()

    // Source device.
    const src = await makeDb()
    await insertServer(src.getEm, 'mcp-1')
    const srcSsot = join(tmp, 'src', 'skills')
    mkdirSync(srcSsot, { recursive: true })
    writeFileSync(join(srcSsot, 'a.md'), 'skill-a')
    const srcKey = new MemKeyStore(Buffer.alloc(32, 0x11))

    await upload(deps(src.db, webdav, srcKey, srcSsot))
    await src.orm.close(true)

    // Target device: empty db + empty ssot + different master key.
    const dst = await makeDb()
    const dstSsot = join(tmp, 'dst', 'skills')
    const dstKey = new MemKeyStore(Buffer.alloc(32, 0x99))

    const outcome = await download(deps(dst.db, webdav, dstKey, dstSsot))

    const rows = (await dst.db.all('SELECT id FROM mcp_servers')) as Array<{ id: string }>
    expect(rows.map((r) => r.id)).toEqual(['mcp-1'])
    expect(existsSync(join(dstSsot, 'a.md'))).toBe(true)
    expect(readFileSync(join(dstSsot, 'a.md'), 'utf8')).toBe('skill-a')
    // Master key landed as the source key → restart required.
    expect((await dstKey.load()).equals(Buffer.alloc(32, 0x11))).toBe(true)
    expect(outcome.needsRestart).toBe(true)
    expect(outcome.deviceName).toBe('test-device')

    await dst.orm.close(true)
  }, 30_000)

  it('download from an empty remote throws RemoteEmpty', async () => {
    const dst = await makeDb()
    const webdav = new MemWebDav()
    const key = new MemKeyStore(Buffer.alloc(32, 0))
    try {
      await download(deps(dst.db, webdav, key, join(tmp, 'd', 'skills')))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError)
      expect((e as SyncError).kind).toBe('remoteEmpty')
    } finally {
      await dst.orm.close(true)
    }
  }, 30_000)

  it('wrong sync password fails and leaves the target db + key unchanged', async () => {
    const webdav = new MemWebDav()
    const src = await makeDb()
    await insertServer(src.getEm, 'mcp-1')
    const srcSsot = join(tmp, 'wp-src', 'skills')
    mkdirSync(srcSsot, { recursive: true })
    const srcKey = new MemKeyStore(Buffer.alloc(32, 0x11))
    await upload(deps(src.db, webdav, srcKey, srcSsot))
    await src.orm.close(true)

    const dst = await makeDb()
    const dstKey = new MemKeyStore(Buffer.alloc(32, 0x99))
    const d = deps(dst.db, webdav, dstKey, join(tmp, 'wp-dst', 'skills'), 'wrong-password')

    try {
      await download(d)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError)
      expect((e as SyncError).kind).toBe('password')
    }
    const rows = (await dst.db.all('SELECT id FROM mcp_servers')) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
    expect((await dstKey.load()).equals(Buffer.alloc(32, 0x99))).toBe(true)
    await dst.orm.close(true)
  }, 30_000)

  it('tampered remote artifact fails integrity', async () => {
    const webdav = new MemWebDav()
    const src = await makeDb()
    const srcSsot = join(tmp, 'tm-src', 'skills')
    mkdirSync(srcSsot, { recursive: true })
    const srcKey = new MemKeyStore(Buffer.alloc(32, 0x11))
    await upload(deps(src.db, webdav, srcKey, srcSsot))
    await src.orm.close(true)

    // Tamper the remote db.sql.
    const dbUrl = [...webdav.files.keys()].find((k) => k.endsWith('db.sql'))!
    webdav.files.set(dbUrl, Buffer.from('tampered-bytes'))

    const dst = await makeDb()
    const dstKey = new MemKeyStore(Buffer.alloc(32, 0x99))
    try {
      await download(deps(dst.db, webdav, dstKey, join(tmp, 'tm-dst', 'skills')))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError)
      expect((e as SyncError).kind).toBe('integrity')
    } finally {
      await dst.orm.close(true)
    }
  }, 30_000)

  it('fetchRemoteInfo reports empty then populated', async () => {
    const webdav = new MemWebDav()
    const src = await makeDb()
    const ssot = join(tmp, 'info', 'skills')
    const key = new MemKeyStore(Buffer.alloc(32, 0x11))

    const empty = await fetchRemoteInfo(deps(src.db, webdav, key, ssot))
    expect(empty.empty).toBe(true)

    mkdirSync(ssot, { recursive: true })
    await upload(deps(src.db, webdav, key, ssot))
    const info = await fetchRemoteInfo(deps(src.db, webdav, key, ssot))
    expect(info.empty).toBe(false)
    expect(info.deviceName).toBe('test-device')
    expect(info.version).toBe(1)
    expect(info.compatible).toBe(true)

    await src.orm.close(true)
  }, 30_000)

  it('upload without a sync password is rejected', async () => {
    const webdav = new MemWebDav()
    const src = await makeDb()
    const key = new MemKeyStore(Buffer.alloc(32, 0x11))
    const d = deps(src.db, webdav, key, join(tmp, 'nopw', 'skills'), '')
    try {
      await upload(d)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError)
      expect((e as SyncError).kind).toBe('password')
    } finally {
      await src.orm.close(true)
    }
  }, 30_000)
})
