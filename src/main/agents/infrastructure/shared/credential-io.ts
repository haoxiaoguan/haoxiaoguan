// Credential injection IO — mirrors Rust primitives::credential_io.
// Three on-disk formats used by the adapters. All writes create parent dirs and
// are written via the shared atomic-write helper (write .tmp then rename).

import { readFileSync, existsSync } from 'node:fs'
import { atomicWrite } from '../../../platform/fs/atomic-write'

/**
 * VSCode-family storage.json: merge token under "storage.serviceMachineId",
 * preserving all other keys. Reads existing file (tolerating corrupt JSON by
 * starting fresh), inserts the key, writes back pretty-printed.
 */
export async function injectCredentialToStorageJson(token: string, storagePath: string): Promise<void> {
  let storage: Record<string, unknown> = {}
  if (existsSync(storagePath)) {
    try {
      const parsed = JSON.parse(readFileSync(storagePath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        storage = parsed as Record<string, unknown>
      }
    } catch {
      storage = {}
    }
  }
  storage['storage.serviceMachineId'] = token
  await atomicWrite(storagePath, JSON.stringify(storage, null, 2))
}

/** Standalone JSON credential file: writes {"token": "..."} (replaces file). */
export async function injectCredentialToJsonFile(token: string, credentialPath: string): Promise<void> {
  await atomicWrite(credentialPath, JSON.stringify({ token }, null, 2))
}

/** GitHub Copilot hosts.json: writes {"github.com": {"oauth_token": "..."}}. */
export async function injectCredentialToHostsJson(token: string, credentialPath: string): Promise<void> {
  const root = { 'github.com': { oauth_token: token } }
  await atomicWrite(credentialPath, JSON.stringify(root, null, 2))
}
