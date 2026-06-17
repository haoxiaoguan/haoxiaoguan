import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { atomicWrite } from '../../platform/fs/atomic-write'
import { AgentError } from '../domain/agent-error'

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
  const content = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    // 不再静默清空：存量文件解析失败时抛错而非用 {} 覆盖，避免抹掉用户原有配置
    // （凭证注入是高价值写入，损坏的 storage.json/hosts.json 宁可中止也不能整文件覆盖）。
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw AgentError.configParse(path, '期望 JSON 对象')
  }
  return parsed as JsonObject
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

/** GitHub Copilot: merge github.com.oauth_token into hosts.json, preserving other hosts/fields. */
export async function injectCredentialToHostsJson(token: string, credentialPath: string): Promise<void> {
  const root = await readJsonObject(credentialPath)
  const existing = root['github.com']
  const githubEntry =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as JsonObject)
      : {}
  githubEntry['oauth_token'] = token
  root['github.com'] = githubEntry
  await atomicWrite(credentialPath, JSON.stringify(root, null, 2))
}

/** Remove a credential file if it exists. */
export async function clearCredentialFile(path: string): Promise<void> {
  if (existsSync(path)) {
    await rm(path, { force: true })
  }
}
