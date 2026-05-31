// McpServer aggregate root — mirrors Rust modules::mcp::domain::mcp_server.
// Pure domain object: no I/O, no electron imports.

import type { AgentId } from '../../../agents/domain/agent-id'
import { isAgentId } from '../../../agents/domain/agent-id'
import type { McpServerSpec, McpTransport } from '../../../agents/domain/mcp-sync'

export type { McpServerSpec, McpTransport }

export class McpServer {
  readonly id: string
  name: string
  description: string | null
  spec: McpServerSpec
  /** key = AgentId string, value = enabled flag */
  apps: Map<AgentId, boolean>
  homepage: string | null
  docs: string | null
  tags: string[]
  created_at: number   // Unix seconds
  updated_at: number   // Unix seconds
  sort_order: number

  private constructor(params: {
    id: string
    name: string
    description: string | null
    spec: McpServerSpec
    apps: Map<AgentId, boolean>
    homepage: string | null
    docs: string | null
    tags: string[]
    created_at: number
    updated_at: number
    sort_order: number
  }) {
    this.id = params.id
    this.name = params.name
    this.description = params.description
    this.spec = params.spec
    this.apps = params.apps
    this.homepage = params.homepage
    this.docs = params.docs
    this.tags = params.tags
    this.created_at = params.created_at
    this.updated_at = params.updated_at
    this.sort_order = params.sort_order
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  static create(params: {
    id: string
    name: string
    description?: string | null
    spec: McpServerSpec
    apps?: Record<string, boolean>
    homepage?: string | null
    docs?: string | null
    tags?: string[]
    sort_order?: number
    now: number
  }): McpServer {
    return new McpServer({
      id: params.id,
      name: params.name,
      description: params.description ?? null,
      spec: params.spec,
      apps: McpServer.appsFromRecord(params.apps ?? {}),
      homepage: params.homepage ?? null,
      docs: params.docs ?? null,
      tags: params.tags ?? [],
      created_at: params.now,
      updated_at: params.now,
      sort_order: params.sort_order ?? 0,
    })
  }

  /** Reconstruct from a DB row (all fields present). */
  static fromRow(row: {
    id: string
    name: string
    description: string | null
    server_json: string
    apps_json: string
    homepage: string | null
    docs: string | null
    tags_json: string
    created_at: number
    updated_at: number
    sort_order: number
  }): McpServer {
    const spec = McpServer.specFromJson(row.server_json)
    const apps = McpServer.appsFromJson(row.apps_json)
    const tags = McpServer.tagsFromJson(row.tags_json)
    return new McpServer({
      id: row.id,
      name: row.name,
      description: row.description,
      spec,
      apps,
      homepage: row.homepage,
      docs: row.docs,
      tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
      sort_order: row.sort_order,
    })
  }

  // ---------------------------------------------------------------------------
  // Serialisation helpers (used by repository)
  // ---------------------------------------------------------------------------

  specToJson(): string {
    return JSON.stringify(this.spec)
  }

  appsToJson(): string {
    const obj: Record<string, boolean> = {}
    for (const [k, v] of this.apps) {
      obj[k] = v
    }
    return JSON.stringify(obj)
  }

  tagsToJson(): string {
    return JSON.stringify(this.tags)
  }

  static specFromJson(json: string): McpServerSpec {
    try {
      const raw = JSON.parse(json) as Record<string, unknown>
      return {
        transport: (raw.transport as McpTransport) ?? 'stdio',
        command: (raw.command as string | null) ?? null,
        args: (raw.args as string[] | null) ?? null,
        env: (raw.env as Record<string, string> | null) ?? null,
        url: (raw.url as string | null) ?? null,
      }
    } catch {
      return { transport: 'stdio', command: null, args: null, env: null, url: null }
    }
  }

  static appsFromJson(json: string): Map<AgentId, boolean> {
    try {
      const raw = JSON.parse(json) as Record<string, boolean>
      return McpServer.appsFromRecord(raw)
    } catch {
      return new Map()
    }
  }

  static appsFromRecord(record: Record<string, boolean>): Map<AgentId, boolean> {
    const map = new Map<AgentId, boolean>()
    for (const [k, v] of Object.entries(record)) {
      if (isAgentId(k)) map.set(k, v)
    }
    return map
  }

  static tagsFromJson(json: string): string[] {
    try {
      return JSON.parse(json) as string[]
    } catch {
      return []
    }
  }

  // ---------------------------------------------------------------------------
  // Domain behaviour
  // ---------------------------------------------------------------------------

  isEnabledFor(agentId: AgentId): boolean {
    return this.apps.get(agentId) === true
  }

  enabledAgents(): AgentId[] {
    const result: AgentId[] = []
    for (const [id, enabled] of this.apps) {
      if (enabled) result.push(id)
    }
    return result
  }

  setApp(agentId: AgentId, enabled: boolean): void {
    this.apps.set(agentId, enabled)
  }

  touch(now: number): void {
    this.updated_at = now
  }

  // ---------------------------------------------------------------------------
  // IPC projection — the shape the frontend expects
  // ---------------------------------------------------------------------------

  toDto(): McpServerDto {
    const appsObj: Record<string, boolean> = {}
    for (const [k, v] of this.apps) {
      appsObj[k] = v
    }
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      spec: this.spec,
      apps: appsObj,
      homepage: this.homepage,
      docs: this.docs,
      tags: this.tags,
      created_at: this.created_at,
      updated_at: this.updated_at,
      sort_order: this.sort_order,
    }
  }
}

/** Wire-format shape returned to the frontend (matches map_mcp.md McpServer). */
export interface McpServerDto {
  id: string
  name: string
  description: string | null
  spec: McpServerSpec
  apps: Record<string, boolean>
  homepage: string | null
  docs: string | null
  tags: string[]
  created_at: number
  updated_at: number
  sort_order: number
}

/** Wire-format shape for unmanaged entries (matches map_mcp.md UnmanagedMcpEntry). */
export interface UnmanagedMcpEntryDto {
  id: string
  name: string
  spec: McpServerSpec
  found_in: string[]
}
