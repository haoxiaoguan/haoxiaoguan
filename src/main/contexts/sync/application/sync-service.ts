import type { SqlDatabase } from './config-port'
import { exportSql, applySql } from './config-port'
import { packSkills, unpackSkills } from './skills-archive'
import { WebdavConfig } from '../domain/webdav-config'
import { SyncError } from '../domain/sync-error'
import {
  SyncManifest,
  MANIFEST_VERSION,
  REMOTE_DB_SQL,
  REMOTE_SKILLS,
  REMOTE_MASTER_KEY,
  REMOTE_MANIFEST,
} from '../domain/sync-manifest'
import type { MasterKeyStore } from '../domain/master-key-store'
import {
  wrapMasterKey,
  unwrapMasterKey,
  SyncCryptoError,
  type WrappedKey,
} from '../domain/sync-crypto'
import {
  type WebDavClient,
  type WebDavAuth,
  authFromCredentials,
  buildRemoteUrl,
} from '../domain/webdav-client'

// Sync orchestration — ties WebDAV client + crypto + SQL export/apply + skills
// archive into the upload/download flows.
//
// upload:   export db.sql → pack skills.zip → wrap master key → compute manifest
//           → ensure dirs → PUT artifacts then manifest.
// download: GET manifest + validate → GET artifacts + integrity-check → unwrap
//           master key (verifies password, mutates nothing) → apply db.sql
//           (transaction) → unpack skills (with rollback) → finally store master
//           key (the only non-rollbackable step, placed last).
// A process-wide serial lock prevents concurrent upload/download interleaving.

/** key_id wrapped into master.key.enc — the runtime global key's fixed id. */
const LEGACY_KEY_ID = '00000000-0000-0000-0000-000000000000'

/** Per-artifact size cap: 512 MB each. */
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024
/** Manifest size cap: 1 MB. */
const MAX_MANIFEST_BYTES = 1024 * 1024

// Module-level promise chain = the global async mutex. Every guarded operation
// links onto `lockChain`, so calls run strictly one-at-a-time across the process
// (the Node equivalent of the Rust tokio::Mutex).
let lockChain: Promise<unknown> = Promise.resolve()

/** Run `fn` under the global serial lock; concurrent callers queue behind it. */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lockChain.then(fn, fn)
  // Keep the chain alive regardless of success/failure, without leaking results.
  lockChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** Dependency bundle for an orchestration call (injectable for tests). */
export interface SyncDeps {
  db: SqlDatabase
  client: WebDavClient
  masterKeyStore: MasterKeyStore
  ssotRoot: string
  config: WebdavConfig
  webdavPassword: string
  syncPassword: string
  deviceName: string
  /** Current unix timestamp (seconds), injected so the domain stays clock-free. */
  nowTs: number
}

export interface UploadOutcome {
  manifestEtag: string | null
}

export interface DownloadOutcome {
  /** True when the master key changed (running crypto service must reload). */
  needsRestart: boolean
  manifestEtag: string | null
  deviceName: string
  createdAt: number
}

export interface RemoteInfo {
  empty: boolean
  deviceName: string | null
  createdAt: number | null
  version: number | null
  compatible: boolean
}

/** Remote directory segments: remote_root parts + "v{VERSION}" + profile parts. */
function remoteSegments(config: WebdavConfig): string[] {
  const segs = config.remoteRoot.split('/').filter((s) => s.length > 0)
  segs.push(`v${MANIFEST_VERSION}`)
  segs.push(...config.profile.split('/').filter((s) => s.length > 0))
  return segs
}

/** Full URL for a remote file under the configured root/version/profile. */
function fileUrl(config: WebdavConfig, fileName: string): string {
  return buildRemoteUrl(config.baseUrl, [...remoteSegments(config), fileName])
}

/** Test connection: PROPFIND base_url + ensure directories (no config save). */
export async function testConnection(deps: SyncDeps): Promise<void> {
  const auth = authFromCredentials(deps.config.username, deps.webdavPassword)
  await deps.client.testConnection(deps.config.baseUrl, auth)
  const segs = remoteSegments(deps.config)
  await deps.client.ensureRemoteDirectories(deps.config.baseUrl, segs, auth)
}

/** Upload: export → pack → wrap → manifest → ensure dirs → PUT all. */
export async function upload(deps: SyncDeps): Promise<UploadOutcome> {
  if (deps.syncPassword.length === 0) {
    throw SyncError.password('同步密码未设置')
  }
  const auth = authFromCredentials(deps.config.username, deps.webdavPassword)

  // (1) Export config tables to db.sql bytes.
  const dbSqlBytes = Buffer.from(await exportSql(deps.db), 'utf8')

  // (2) Pack skills.zip.
  const skillsBytes = await packSkills(deps.ssotRoot)

  // (3) Read the runtime global key and wrap it into master.key.enc.
  const masterKey = await deps.masterKeyStore.load()
  const wrapped = await wrapMasterKey(deps.syncPassword, LEGACY_KEY_ID, masterKey).catch(
    mapCryptoError,
  )
  const masterKeyBytes = Buffer.from(JSON.stringify(wrapped, null, 2), 'utf8')

  // (4) Build manifest (SHA-256 + size per artifact).
  const manifest = SyncManifest.build(deps.deviceName, deps.nowTs, [
    [REMOTE_DB_SQL, dbSqlBytes],
    [REMOTE_SKILLS, skillsBytes],
    [REMOTE_MASTER_KEY, masterKeyBytes],
  ])
  const manifestBytes = manifest.toJsonBytes()

  // (5) Ensure remote directories exist.
  const segs = remoteSegments(deps.config)
  await deps.client.ensureRemoteDirectories(deps.config.baseUrl, segs, auth)

  // (6) PUT artifacts first, manifest last (so a visible manifest implies the
  //     artifacts are already in place).
  await deps.client.putBytes(fileUrl(deps.config, REMOTE_DB_SQL), auth, dbSqlBytes, 'application/sql')
  await deps.client.putBytes(
    fileUrl(deps.config, REMOTE_SKILLS),
    auth,
    skillsBytes,
    'application/zip',
  )
  await deps.client.putBytes(
    fileUrl(deps.config, REMOTE_MASTER_KEY),
    auth,
    masterKeyBytes,
    'application/json',
  )
  const manifestUrl = fileUrl(deps.config, REMOTE_MANIFEST)
  await deps.client.putBytes(manifestUrl, auth, manifestBytes, 'application/json')

  // (7) HEAD for the manifest ETag (best-effort).
  let manifestEtag: string | null = null
  try {
    manifestEtag = await deps.client.headEtag(manifestUrl, auth)
  } catch {
    manifestEtag = null
  }

  return { manifestEtag }
}

/** Download + apply (see module doc for step ordering and rollback semantics). */
export async function download(deps: SyncDeps): Promise<DownloadOutcome> {
  if (deps.syncPassword.length === 0) {
    throw SyncError.password('同步密码未设置')
  }
  const auth = authFromCredentials(deps.config.username, deps.webdavPassword)

  // (1) GET manifest (missing → RemoteEmpty) → validate format/version.
  const manifestUrl = fileUrl(deps.config, REMOTE_MANIFEST)
  const fetched = await deps.client.getBytes(manifestUrl, auth, MAX_MANIFEST_BYTES)
  if (!fetched) {
    throw SyncError.remoteEmpty()
  }
  const manifest = SyncManifest.fromJsonBytes(fetched.bytes)
  manifest.validateCompat()

  // (2) GET each artifact and integrity-check individually.
  const dbSqlBytes = await getAndVerify(deps, auth, manifest, REMOTE_DB_SQL)
  const skillsBytes = await getAndVerify(deps, auth, manifest, REMOTE_SKILLS)
  const masterKeyBytes = await getAndVerify(deps, auth, manifest, REMOTE_MASTER_KEY)

  // (3) Unwrap master.key.enc (verifies the sync password) — mutates nothing.
  let wrapped: WrappedKey
  try {
    wrapped = JSON.parse(masterKeyBytes.toString('utf8')) as WrappedKey
  } catch (e) {
    throw SyncError.config(`JSON 序列化/反序列化失败: ${(e as Error).message}`)
  }
  const { key: newMasterKey } = await unwrapMasterKey(deps.syncPassword, wrapped).catch(
    mapCryptoError,
  )

  // (4) Apply db.sql (transactional; failure rolls back, local state unchanged).
  const dbSqlStr = dbSqlBytes.toString('utf8')
  await applySql(deps.db, dbSqlStr)

  // (5) Unpack skills (internal staging + rollback on failure).
  await unpackSkills(deps.ssotRoot, skillsBytes)

  // (6) Finally store the master key (the only non-rollbackable keychain write,
  //     placed last and least likely to fail).
  let oldKey: Buffer | null = null
  try {
    oldKey = await deps.masterKeyStore.load()
  } catch {
    oldKey = null
  }
  await deps.masterKeyStore.store(newMasterKey)
  // Restart only needed if the key changed; if the old key was unreadable, be
  // conservative and require restart.
  const needsRestart = oldKey ? !oldKey.equals(newMasterKey) : true

  return {
    needsRestart,
    manifestEtag: fetched.etag,
    deviceName: manifest.deviceName,
    createdAt: manifest.createdAt,
  }
}

/** Fetch only the remote manifest overview (no artifact download). */
export async function fetchRemoteInfo(deps: SyncDeps): Promise<RemoteInfo> {
  const auth = authFromCredentials(deps.config.username, deps.webdavPassword)
  const manifestUrl = fileUrl(deps.config, REMOTE_MANIFEST)
  const fetched = await deps.client.getBytes(manifestUrl, auth, MAX_MANIFEST_BYTES)
  if (!fetched) {
    return { empty: true, deviceName: null, createdAt: null, version: null, compatible: false }
  }
  const manifest = SyncManifest.fromJsonBytes(fetched.bytes)
  let compatible = true
  try {
    manifest.validateCompat()
  } catch {
    compatible = false
  }
  return {
    empty: false,
    deviceName: manifest.deviceName,
    createdAt: manifest.createdAt,
    version: manifest.version,
    compatible,
  }
}

/** GET one artifact (missing → integrity error) and verify against the manifest. */
async function getAndVerify(
  deps: SyncDeps,
  auth: WebDavAuth,
  manifest: SyncManifest,
  name: string,
): Promise<Buffer> {
  const url = fileUrl(deps.config, name)
  const fetched = await deps.client.getBytes(url, auth, MAX_ARTIFACT_BYTES)
  if (!fetched) {
    throw SyncError.integrity(`远端缺少 artifact: ${name}`)
  }
  manifest.verifyArtifact(name, fetched.bytes)
  return fetched.bytes
}

/**
 * Map a crypto-layer error to a SyncError. Decrypt failures become Password
 * errors (prompt re-entry); everything else is Crypto.
 */
function mapCryptoError(e: unknown): never {
  if (e instanceof SyncCryptoError) {
    if (e.kind === 'decrypt') {
      throw SyncError.password('同步密码错误或 master.key.enc 已损坏')
    }
    throw SyncError.crypto(e.message)
  }
  if (e instanceof SyncError) {
    throw e
  }
  throw SyncError.crypto((e as Error).message)
}
