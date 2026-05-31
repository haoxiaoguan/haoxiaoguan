// McpSync interface — mirrors Rust agents::domain::mcp_sync.
// Each MCP-capable agent adapter implements this interface.

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerSpec {
  transport: McpTransport
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
}

export interface McpSync {
  /** Absolute path to the agent's config file. */
  configPath(): string
  /** Insert or replace a server entry in the agent's config (atomic write). */
  upsertServer(id: string, spec: McpServerSpec): Promise<void>
  /** Remove a server entry from the agent's config (no-op if absent). */
  removeServer(id: string): Promise<void>
  /** Return all server entries currently in the agent's config. */
  listServers(): Promise<Record<string, McpServerSpec>>
  /** Whether `cmd` resolves on PATH (uses `which`/`where.exe`). */
  validateCommand(cmd: string): Promise<boolean>
}
