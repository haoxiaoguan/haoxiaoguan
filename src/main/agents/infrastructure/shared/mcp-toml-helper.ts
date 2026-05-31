// Codex MCP TOML config helpers — mirrors Rust
// agents::infrastructure::shared::{mcp_toml_helper read+write} for
// ~/.codex/config.toml under the [mcp_servers.*] tables.
//
// PORTING RISK: the Rust source uses `toml_edit` for comment-preserving,
// format-preserving edits. Node has no faithful equivalent; this port uses
// `@iarna/toml` which parses to a plain object and re-serializes, so comments
// and unrelated formatting in a hand-edited config.toml are NOT preserved
// (functional content IS preserved). This matches the documented fidelity risk.

import { readFileSync, existsSync } from 'node:fs'
import TOML from '@iarna/toml'
import { atomicWrite } from '../../../platform/fs/atomic-write'
import { AgentError } from '../../domain/agent-error'
import type { McpServerSpec, McpTransport } from '../../domain/mcp-sync'

type TomlTable = Record<string, unknown>

/** Read `[<key>.*]` tables into McpServerSpec records (mirrors read_mcp_servers_from_toml). */
export async function readMcpServersFromToml(
  path: string,
  key: string,
): Promise<Record<string, McpServerSpec>> {
  if (!existsSync(path)) return {}
  const root = parseTomlFile(path)
  const table = root[key]
  if (!isObject(table)) return {}
  const result: Record<string, McpServerSpec> = {}
  for (const [id, val] of Object.entries(table)) {
    const spec = parseMcpSpecToml(val)
    if (spec) result[id] = spec
  }
  return result
}

/** Upsert `[<key>.<id>]` with `spec`. Preserves other tables (not comments). Atomic write. */
export async function upsertMcpServerInToml(
  path: string,
  key: string,
  id: string,
  spec: McpServerSpec,
): Promise<void> {
  let root: TomlTable = {}
  if (existsSync(path)) root = parseTomlFile(path)

  let parent = root[key]
  if (!isObject(parent)) {
    parent = {}
    root[key] = parent
  }

  const serverTable: TomlTable = {}
  if (spec.transport === 'stdio') {
    if (spec.command != null) serverTable.command = spec.command
    if (spec.args != null) serverTable.args = spec.args
    if (spec.env != null && Object.keys(spec.env).length > 0) serverTable.env = spec.env
  } else {
    if (spec.url != null) serverTable.url = spec.url
  }
  ;(parent as TomlTable)[id] = serverTable

  await writeTomlFile(path, root)
}

/** Remove `[<key>.<id>]` if present. No-op if file/key absent. Atomic write. */
export async function removeMcpServerFromToml(path: string, key: string, id: string): Promise<void> {
  if (!existsSync(path)) return
  const root = parseTomlFile(path)
  const parent = root[key]
  if (isObject(parent)) {
    delete (parent as TomlTable)[id]
  }
  await writeTomlFile(path, root)
}

// ---- internals ----

function parseTomlFile(path: string): TomlTable {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (e) {
    throw AgentError.filesystem(path, e)
  }
  try {
    return TOML.parse(content) as TomlTable
  } catch (e) {
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
}

async function writeTomlFile(path: string, root: TomlTable): Promise<void> {
  let content: string
  try {
    content = TOML.stringify(root as TOML.JsonMap)
  } catch (e) {
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
  await atomicWrite(path, content)
}

/**
 * Parse a [mcp_servers.<id>] table. stdio by default; http only when a url is
 * present and no command (mirrors Rust parse_mcp_spec_toml).
 */
function parseMcpSpecToml(value: unknown): McpServerSpec | null {
  if (!isObject(value)) return null
  const table = value as TomlTable
  const command = typeof table.command === 'string' ? table.command : null
  const url = typeof table.url === 'string' ? table.url : null
  const transport: McpTransport = url != null && command == null ? 'http' : 'stdio'
  return {
    transport,
    command,
    args: Array.isArray(table.args)
      ? table.args.filter((x): x is string => typeof x === 'string')
      : null,
    env: isObject(table.env)
      ? Object.fromEntries(
          Object.entries(table.env as TomlTable).filter(
            (e): e is [string, string] => typeof e[1] === 'string',
          ),
        )
      : null,
    url,
  }
}

function isObject(v: unknown): v is TomlTable {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
