import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { atomicWrite } from '../../platform/fs/atomic-write'

// Credential-IO primitives — faithful port of Rust primitives::credential_io.
// Three on-disk formats: VSCode-family storage.json (merge), standalone JSON
// {"token":...}, and GitHub Copilot hosts.json {"github.com":{"oauth_token":...}}.
//
// The source used a plain fs::write; per the migration design (porting risk #10)
// we use atomicWrite (temp-file-then-rename) to avoid corrupting the IDE config
// on a partial write. Output is pretty-printed JSON (2-space) like serde
// to_string_pretty.

type JsonObject = Record<string, unknown>

async function readJsonObject(path: string): Promise<JsonObject> {
  if (!existsSync(path)) return {}
  try {
    const content = await readFile(path, 'utf8')
    const parsed = JSON.parse(content) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {}
  } catch {
    // Unparseable existing file → start from empty (mirrors unwrap_or json!({})).
    return {}
  }
}

/** VSCode family: merge token into storage.json's storage.serviceMachineId. */
export async function injectCredentialToStorageJson(token: string, storagePath: string): Promise<void> {
  const storage = await readJsonObject(storagePath)
  storage['storage.serviceMachineId'] = token
  await atomicWrite(storagePath, JSON.stringify(storage, null, 2))
}

/** Standalone family: overwrite the file with {"token": "..."}. */
export async function injectCredentialToJsonFile(token: string, credentialPath: string): Promise<void> {
  await atomicWrite(credentialPath, JSON.stringify({ token }, null, 2))
}

/** GitHub Copilot: overwrite hosts.json with {"github.com":{"oauth_token":...}}. */
export async function injectCredentialToHostsJson(token: string, credentialPath: string): Promise<void> {
  await atomicWrite(credentialPath, JSON.stringify({ 'github.com': { oauth_token: token } }, null, 2))
}

/** Remove a credential file if it exists. */
export async function clearCredentialFile(path: string): Promise<void> {
  if (existsSync(path)) {
    await rm(path, { force: true })
  }
}
