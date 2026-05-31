import { createHash } from 'node:crypto'
import { SyncError } from './sync-error'

// Sync manifest (manifest.json) — 对应 modules/sync/domain/manifest.rs.
//
// Holds metadata + each artifact's SHA-256 + byte size + protocol version. On
// upload it is built from artifact bytes and shipped alongside; on download the
// format/version are strictly validated, then every artifact is integrity-checked
// against its recorded sha256+size before any local state is mutated.
//
// Determinism: the source uses a BTreeMap so JSON key order is stable across
// devices. We replicate by sorting artifact keys when serializing.

export const MANIFEST_FORMAT = 'haoxiaoguan-webdav-sync'
export const MANIFEST_VERSION = 1

export const REMOTE_DB_SQL = 'db.sql'
export const REMOTE_SKILLS = 'skills.zip'
export const REMOTE_MASTER_KEY = 'master.key.enc'
export const REMOTE_MANIFEST = 'manifest.json'

/** Per-artifact integrity metadata: lowercase-hex SHA-256 and byte count. */
export interface ArtifactMeta {
  sha256: string
  size: number
}

/** Compute the lowercase-hex SHA-256 of bytes. */
export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface SyncManifestJson {
  format: string
  version: number
  deviceName: string
  createdAt: number
  artifacts: Record<string, ArtifactMeta>
}

/**
 * Sync manifest aggregate. Enforces format/version compatibility and per-artifact
 * integrity. Built clock-free (createdAt is injected by the caller).
 */
export class SyncManifest {
  readonly format: string
  readonly version: number
  readonly deviceName: string
  readonly createdAt: number
  readonly artifacts: Map<string, ArtifactMeta>

  private constructor(
    format: string,
    version: number,
    deviceName: string,
    createdAt: number,
    artifacts: Map<string, ArtifactMeta>,
  ) {
    this.format = format
    this.version = version
    this.deviceName = deviceName
    this.createdAt = createdAt
    this.artifacts = artifacts
  }

  /**
   * Build a manifest from artifact (name, bytes) pairs, computing SHA-256 + size
   * for each and stamping the current format/version.
   */
  static build(
    deviceName: string,
    createdAt: number,
    artifacts: Array<[string, Buffer | Uint8Array]>,
  ): SyncManifest {
    const map = new Map<string, ArtifactMeta>()
    for (const [name, bytes] of artifacts) {
      map.set(name, { sha256: sha256Hex(bytes), size: bytes.length })
    }
    return new SyncManifest(MANIFEST_FORMAT, MANIFEST_VERSION, deviceName, createdAt, map)
  }

  /** Serialize to pretty JSON bytes with deterministic (sorted) artifact keys. */
  toJsonBytes(): Buffer {
    const artifacts: Record<string, ArtifactMeta> = {}
    for (const key of [...this.artifacts.keys()].sort()) {
      artifacts[key] = this.artifacts.get(key)!
    }
    const obj: SyncManifestJson = {
      format: this.format,
      version: this.version,
      deviceName: this.deviceName,
      createdAt: this.createdAt,
      artifacts,
    }
    return Buffer.from(JSON.stringify(obj, null, 2), 'utf8')
  }

  /** Parse from JSON bytes; throws SyncError.config on malformed JSON. */
  static fromJsonBytes(bytes: Buffer | Uint8Array): SyncManifest {
    let parsed: SyncManifestJson
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as SyncManifestJson
    } catch (e) {
      throw SyncError.config(`JSON 序列化/反序列化失败: ${(e as Error).message}`)
    }
    const map = new Map<string, ArtifactMeta>()
    for (const [name, meta] of Object.entries(parsed.artifacts ?? {})) {
      map.set(name, { sha256: meta.sha256, size: meta.size })
    }
    return new SyncManifest(
      parsed.format,
      parsed.version,
      parsed.deviceName,
      parsed.createdAt,
      map,
    )
  }

  /** Reject incompatible format/version before download proceeds. */
  validateCompat(): void {
    if (this.format !== MANIFEST_FORMAT) {
      throw SyncError.config(
        `manifest format 不匹配: 期望 ${MANIFEST_FORMAT}, 实际 ${this.format}`,
      )
    }
    if (this.version !== MANIFEST_VERSION) {
      throw SyncError.versionIncompatible(MANIFEST_VERSION, this.version)
    }
  }

  /** Verify an artifact's bytes match the recorded size + SHA-256. */
  verifyArtifact(name: string, bytes: Buffer | Uint8Array): void {
    const meta = this.artifacts.get(name)
    if (!meta) {
      throw SyncError.integrity(`manifest 缺少 artifact 记录: ${name}`)
    }
    if (bytes.length !== meta.size) {
      throw SyncError.integrity(
        `${name} 大小不符: 期望 ${meta.size}, 实际 ${bytes.length}`,
      )
    }
    const actual = sha256Hex(bytes)
    if (actual !== meta.sha256) {
      throw SyncError.integrity(
        `${name} SHA-256 不符: 期望 ${meta.sha256.slice(0, 8)}…, 实际 ${actual.slice(0, 8)}…`,
      )
    }
  }
}
