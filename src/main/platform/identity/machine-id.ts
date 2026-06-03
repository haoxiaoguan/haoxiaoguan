import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appDataDir } from '../persistence/paths'

// Stable per-install device identifier. Kiro's AWS SDK User-Agent embeds a
// machineId (see kiro-identity-client); the upstream IDE uses a 64-char hex id.
// This is NOT a secret — it only needs to be stable across launches so the
// upstream can correlate a device. Persisted as plaintext under appDataDir so it
// honours HXG_USER_DATA_DIR (e2e isolation) and survives restarts.

const FILE_NAME = 'machine.id'

let cached: string | undefined

function machineIdPath(): string {
  return join(appDataDir(), FILE_NAME)
}

/** A 64-char lowercase-hex id, matching the shape Kiro's IDE reports. */
function generateMachineId(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, '')
}

/**
 * Returns a stable machine id for the given accountId (P1-3 per-account isolation),
 * or the persistent process-level id when called without arguments.
 *
 * With accountId: deterministic sha256-derived 64-char hex, unique per account,
 * stable across restarts, no disk I/O, not entered into the process-level cache.
 *
 * Without accountId: persistent process-level id (read from / written to machine.id).
 * Read/write errors fall back to an in-memory id for this process so a read-only
 * home dir never blocks a network call that merely wants a UA token.
 */
export function getMachineId(accountId?: string): string {
  // Per-account path: deterministic sha256 derive, no persistence, no cache pollution.
  if (accountId !== undefined) {
    return createHash('sha256').update('kiro-device-' + accountId).digest('hex').slice(0, 64)
  }

  // Process-level singleton path (original behaviour, unchanged).
  if (cached !== undefined) return cached
  const path = machineIdPath()
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf8').trim()
      if (existing.length > 0) {
        cached = existing
        return cached
      }
    }
  } catch {
    // fall through to (re)generation
  }
  const id = generateMachineId()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, id, 'utf8')
    // Restrict file permissions to owner-only (P2-5 alignment with master.key.enc).
    if (process.platform !== 'win32') {
      try {
        chmodSync(path, 0o600)
      } catch {
        // best-effort; non-fatal on read-only or restricted filesystems
      }
    }
  } catch {
    // best-effort persistence; still return a usable id this session
  }
  cached = id
  return cached
}
