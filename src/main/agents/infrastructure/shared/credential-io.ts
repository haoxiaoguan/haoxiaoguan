// Credential injection IO — mirrors Rust primitives::credential_io.
// Three on-disk formats used by the adapters. All writes create parent dirs and
// are written via the shared atomic-write helper (write .tmp then rename).

import { readFileSync, existsSync } from 'node:fs'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import { AgentError } from '../../domain/agent-error'

/**
 * 读取并解析既有 JSON 对象配置。
 * 不存在 → {}（首次注入）；存在但解析失败/非对象 → 抛 AgentError.configParse，
 * 绝不返回 {} 让调用方整文件覆盖（否则会抹掉用户原有配置）。
 */
function readJsonObjectSync(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const content = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw AgentError.configParse(path, '期望 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

/**
 * VSCode-family storage.json: merge token under "storage.serviceMachineId",
 * preserving all other keys. 既有文件解析失败时抛错（不再静默清空覆盖）。
 */
export async function injectCredentialToStorageJson(token: string, storagePath: string): Promise<void> {
  const storage = readJsonObjectSync(storagePath)
  storage['storage.serviceMachineId'] = token
  await atomicWrite(storagePath, JSON.stringify(storage, null, 2))
}

/** Standalone JSON credential file: writes {"token": "..."} (replaces file). */
export async function injectCredentialToJsonFile(token: string, credentialPath: string): Promise<void> {
  await atomicWrite(credentialPath, JSON.stringify({ token }, null, 2))
}

/** GitHub Copilot hosts.json: merge github.com.oauth_token, preserving other hosts/fields. */
export async function injectCredentialToHostsJson(token: string, credentialPath: string): Promise<void> {
  const root = readJsonObjectSync(credentialPath)
  const existing = root['github.com']
  const githubEntry =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  githubEntry['oauth_token'] = token
  root['github.com'] = githubEntry
  await atomicWrite(credentialPath, JSON.stringify(root, null, 2))
}
