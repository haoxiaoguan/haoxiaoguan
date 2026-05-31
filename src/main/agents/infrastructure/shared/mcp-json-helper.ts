// MCP JSON config helpers — mirrors Rust
// agents::infrastructure::shared::mcp_json_helper.
//
// Shared read/upsert/remove for JSON-backed MCP configs (Claude, Gemini,
// Hermes, OpenCode, ClaudeDesktop). The serialized shape matches the source's
// spec_to_value: stdio → { type, command?, args?, env? }; http/sse → { type, url? }.
// Writes are atomic (write .tmp then rename) and create parent dirs.

import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import { AgentError } from '../../domain/agent-error'
import type { McpServerSpec, McpTransport } from '../../domain/mcp-sync'

const execFileAsync = promisify(execFile)

type JsonObject = Record<string, unknown>

/** Read the `<key>` map from a JSON config file into McpServerSpec records. */
export async function readMcpServersFromJson(
  path: string,
  key: string,
): Promise<Record<string, McpServerSpec>> {
  if (!existsSync(path)) return {}
  const root = parseJsonFile(path)
  const servers = root[key]
  if (!isObject(servers)) return {}
  const result: Record<string, McpServerSpec> = {}
  for (const [id, val] of Object.entries(servers)) {
    const spec = parseMcpSpec(val)
    if (spec) result[id] = spec
  }
  return result
}

/** Insert/replace `<key>.<id>` with `spec`, preserving other keys. Atomic write. */
export async function upsertMcpServerInJson(
  path: string,
  key: string,
  id: string,
  spec: McpServerSpec,
): Promise<void> {
  let root: JsonObject = {}
  if (existsSync(path)) {
    root = parseJsonFile(path)
  }
  let servers = root[key]
  if (!isObject(servers)) {
    servers = {}
    root[key] = servers
  }
  ;(servers as JsonObject)[id] = specToValue(spec)
  await atomicWrite(path, JSON.stringify(root, null, 2))
}

/** Remove `<key>.<id>` if present. No-op if file/key absent. Atomic write. */
export async function removeMcpServerFromJson(path: string, key: string, id: string): Promise<void> {
  if (!existsSync(path)) return
  const root = parseJsonFile(path)
  const servers = root[key]
  if (isObject(servers)) {
    delete (servers as JsonObject)[id]
  }
  await atomicWrite(path, JSON.stringify(root, null, 2))
}

/**
 * Whether `cmd` resolves on PATH. Uses `which` on Unix and `where.exe` on
 * Windows via child_process (mirrors Rust validate_command_exists, which shells
 * out to `which`). Returns false if the lookup command fails or is not found.
 */
export async function validateCommandExists(cmd: string): Promise<boolean> {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFileAsync(lookup, [cmd])
    return true
  } catch {
    return false
  }
}

// ---- internals ----

function parseJsonFile(path: string): JsonObject {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (e) {
    throw AgentError.filesystem(path, e)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
  if (!isObject(parsed)) {
    throw AgentError.configParse(path, 'root is not an object')
  }
  return parsed as JsonObject
}

export function specToValue(spec: McpServerSpec): JsonObject {
  const out: JsonObject = {}
  if (spec.transport === 'stdio') {
    out.type = 'stdio'
    if (spec.command != null) out.command = spec.command
    if (spec.args != null) out.args = spec.args
    if (spec.env != null) out.env = spec.env
  } else {
    out.type = spec.transport // 'http' | 'sse'
    if (spec.url != null) out.url = spec.url
  }
  return out
}

export function parseMcpSpec(value: unknown): McpServerSpec | null {
  if (!isObject(value)) return null
  const obj = value as JsonObject
  const typeStr = typeof obj.type === 'string' ? obj.type : 'stdio'
  const transport: McpTransport =
    typeStr === 'http' ? 'http' : typeStr === 'sse' ? 'sse' : 'stdio'
  return {
    transport,
    command: typeof obj.command === 'string' ? obj.command : null,
    args: stringArray(obj.args),
    env: stringMap(obj.env),
    url: typeof obj.url === 'string' ? obj.url : null,
  }
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  return v.filter((x): x is string => typeof x === 'string')
}

function stringMap(v: unknown): Record<string, string> | null {
  if (!isObject(v)) return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
