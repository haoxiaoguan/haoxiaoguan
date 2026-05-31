// Shared McpSync implementations — JSON-backed (Claude/Gemini/Hermes/OpenCode/
// ClaudeDesktop) and TOML-backed (Codex). Each is bound to a config path and the
// top-level key the servers map lives under (mcpServers / mcp / mcp_servers).

import type { McpServerSpec, McpSync } from '../../domain/mcp-sync'
import {
  readMcpServersFromJson,
  upsertMcpServerInJson,
  removeMcpServerFromJson,
  validateCommandExists,
} from './mcp-json-helper'
import {
  readMcpServersFromToml,
  upsertMcpServerInToml,
  removeMcpServerFromToml,
} from './mcp-toml-helper'

/** JSON-backed McpSync (objects under `<key>`). */
export class JsonMcpSync implements McpSync {
  constructor(
    private readonly path: string,
    private readonly key: string,
  ) {}

  configPath(): string {
    return this.path
  }

  upsertServer(id: string, spec: McpServerSpec): Promise<void> {
    return upsertMcpServerInJson(this.path, this.key, id, spec)
  }

  removeServer(id: string): Promise<void> {
    return removeMcpServerFromJson(this.path, this.key, id)
  }

  listServers(): Promise<Record<string, McpServerSpec>> {
    return readMcpServersFromJson(this.path, this.key)
  }

  validateCommand(cmd: string): Promise<boolean> {
    return validateCommandExists(cmd)
  }
}

/** TOML-backed McpSync (Codex config.toml; writes via TOML, reads via TOML). */
export class TomlMcpSync implements McpSync {
  constructor(
    private readonly path: string,
    private readonly key: string,
  ) {}

  configPath(): string {
    return this.path
  }

  upsertServer(id: string, spec: McpServerSpec): Promise<void> {
    return upsertMcpServerInToml(this.path, this.key, id, spec)
  }

  removeServer(id: string): Promise<void> {
    return removeMcpServerFromToml(this.path, this.key, id)
  }

  listServers(): Promise<Record<string, McpServerSpec>> {
    return readMcpServersFromToml(this.path, this.key)
  }

  validateCommand(cmd: string): Promise<boolean> {
    return validateCommandExists(cmd)
  }
}
