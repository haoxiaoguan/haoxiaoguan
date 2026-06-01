import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
 * Returns the persistent machine id, creating it on first use. Read/write
 * errors fall back to an in-memory id for this process so a read-only home dir
 * never blocks a network call that merely wants a UA token.
 */
export function getMachineId(): string {
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
  } catch {
    // best-effort persistence; still return a usable id this session
  }
  cached = id
  return cached
}
