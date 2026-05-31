// McpApplicationService — use cases for the mcp context.
// Mirrors Rust modules::mcp::application::mcp_service::McpApplicationService.
//
// Responsibilities:
//   get_servers        — load all from DB ordered by sort_order
//   upsert_server      — create-or-update, sync spec to all enabled agents, save to DB
//   delete_server      — remove from all enabled agent configs, delete from DB
//   toggle_app         — flip one agent's enabled flag, sync/remove from that agent, save
//   import_from_apps   — read all MCP-capable agents, skip already-in-DB, bulk-insert
//   scan_unmanaged     — same aggregation but returns without writing
//   import_selected    — user-chosen subset: upsert to DB, does NOT re-sync to agents
//   validate_command   — shell out to which/where and return boolean
//   get_claude_mcp_status — per-agent { server_count, config_exists, config_path }
//   read_agent_mcp_config — raw Record<string, McpServerSpec> from one agent's config

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { McpServerRepository } from '../domain/mcp-server-repository'
import { McpServer } from '../domain/mcp-server'
import type { McpServerSpec } from '../domain/mcp-server'
import type { AgentId } from '../../../agents/domain/agent-id'
import { parseAgentId } from '../../../agents/domain/agent-id'
import type { AgentRegistry } from '../../../agents/domain/agent-registry'
import type { McpSync } from '../../../agents/domain/mcp-sync'
import type { UnmanagedMcpEntryDto } from '../domain/mcp-server'

export interface UpsertMcpServerRequest {
  id?: string
  name: string
  description?: string | null
  transport: 'stdio' | 'http' | 'sse'
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  url?: string | null
  apps?: Record<string, boolean>
  homepage?: string | null
  docs?: string | null
  tags?: string[]
}

export interface ToggleMcpAppRequest {
  server_id: string
  agent_id: string
  enabled: boolean
}

export interface ImportSelectedRequest {
  selections: Array<{ server_id: string; agent_ids: string[] }>
}

export interface ClaudeStatusEntry {
  server_count: number
  config_exists: boolean
  config_path: string
}

export class McpApplicationService {
  constructor(
    private readonly repo: McpServerRepository,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // get_servers
  // ---------------------------------------------------------------------------

  async getServers(): Promise<McpServer[]> {
    return this.repo.findAll()
  }

  // ---------------------------------------------------------------------------
  // upsert_server
  // ---------------------------------------------------------------------------

  async upsertServer(req: UpsertMcpServerRequest): Promise<McpServer> {
    const now = Math.floor(Date.now() / 1000)
    const spec: McpServerSpec = {
      transport: req.transport,
      command: req.command ?? null,
      args: req.args ?? null,
      env: req.env ?? null,
      url: req.url ?? null,
    }

    let server: McpServer
    if (req.id) {
      // Update existing
      const existing = await this.repo.findById(req.id)
      if (existing) {
        existing.name = req.name
        existing.description = req.description ?? null
        existing.spec = spec
        existing.homepage = req.homepage ?? null
        existing.docs = req.docs ?? null
        existing.tags = req.tags ?? []
        if (req.apps !== undefined) {
          existing.apps = McpServer.appsFromRecord(req.apps)
        }
        existing.touch(now)
        server = existing
      } else {
        // id provided but not found — create with that id
        server = McpServer.create({
          id: req.id,
          name: req.name,
          description: req.description,
          spec,
          apps: req.apps,
          homepage: req.homepage,
          docs: req.docs,
          tags: req.tags,
          now,
        })
      }
    } else {
      // Create new
      server = McpServer.create({
        id: randomUUID(),
        name: req.name,
        description: req.description,
        spec,
        apps: req.apps,
        homepage: req.homepage,
        docs: req.docs,
        tags: req.tags,
        now,
      })
    }

    // Sync spec to all currently-enabled agents before saving to DB
    await this.syncEnabledAgents(server)

    await this.repo.save(server)
    return server
  }

  // ---------------------------------------------------------------------------
  // delete_server
  // ---------------------------------------------------------------------------

  async deleteServer(serverId: string): Promise<boolean> {
    const server = await this.repo.findById(serverId)
    if (!server) return false

    // Remove from all enabled agent configs
    for (const agentId of server.enabledAgents()) {
      const mcpSync = this.getMcpSync(agentId)
      if (mcpSync) {
        try {
          await mcpSync.removeServer(server.id)
        } catch {
          // best-effort — continue removing from other agents
        }
      }
    }

    await this.repo.delete(serverId)
    return true
  }

  // ---------------------------------------------------------------------------
  // toggle_app
  // ---------------------------------------------------------------------------

  async toggleApp(req: ToggleMcpAppRequest): Promise<void> {
    const agentId = parseAgentId(req.agent_id)
    const server = await this.repo.findById(req.server_id)
    if (!server) {
      throw new Error(`MCP server not found: ${req.server_id}`)
    }

    server.setApp(agentId, req.enabled)
    server.touch(Math.floor(Date.now() / 1000))

    const mcpSync = this.getMcpSync(agentId)
    if (mcpSync) {
      if (req.enabled) {
        await mcpSync.upsertServer(server.id, server.spec)
      } else {
        await mcpSync.removeServer(server.id)
      }
    }

    await this.repo.save(server)
  }

  // ---------------------------------------------------------------------------
  // import_from_apps
  // ---------------------------------------------------------------------------

  async importFromApps(): Promise<{ imported_count: number }> {
    const existing = await this.repo.findAll()
    const existingIds = new Set(existing.map((s) => s.id))

    const aggregated = await this.aggregateFromAgents()
    const now = Math.floor(Date.now() / 1000)
    let imported_count = 0

    for (const [serverId, entry] of aggregated) {
      if (existingIds.has(serverId)) continue

      const appsRecord: Record<string, boolean> = {}
      for (const agentId of entry.foundIn) {
        appsRecord[agentId] = true
      }

      const server = McpServer.create({
        id: serverId,
        name: entry.name,
        spec: entry.spec,
        apps: appsRecord,
        now,
      })

      await this.repo.save(server)
      imported_count++
    }

    return { imported_count }
  }

  // ---------------------------------------------------------------------------
  // scan_unmanaged
  // ---------------------------------------------------------------------------

  async scanUnmanaged(): Promise<UnmanagedMcpEntryDto[]> {
    const existing = await this.repo.findAll()
    const existingIds = new Set(existing.map((s) => s.id))

    const aggregated = await this.aggregateFromAgents()
    const result: UnmanagedMcpEntryDto[] = []

    for (const [serverId, entry] of aggregated) {
      if (existingIds.has(serverId)) continue
      result.push({
        id: serverId,
        name: entry.name,
        spec: entry.spec,
        found_in: entry.foundIn,
      })
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // import_selected — does NOT re-sync to agent files (they already have it)
  // ---------------------------------------------------------------------------

  async importSelected(req: ImportSelectedRequest): Promise<{ imported_count: number }> {
    const now = Math.floor(Date.now() / 1000)
    let imported_count = 0

    for (const selection of req.selections) {
      // Fetch spec from agent configs
      let spec: McpServerSpec | null = null
      let name = selection.server_id

      for (const agentIdStr of selection.agent_ids) {
        let agentId: AgentId
        try {
          agentId = parseAgentId(agentIdStr)
        } catch {
          continue
        }
        const mcpSync = this.getMcpSync(agentId)
        if (!mcpSync) continue
        try {
          const servers = await mcpSync.listServers()
          if (servers[selection.server_id]) {
            spec = servers[selection.server_id]
            name = selection.server_id
            break
          }
        } catch {
          continue
        }
      }

      if (!spec) continue

      const appsRecord: Record<string, boolean> = {}
      for (const agentIdStr of selection.agent_ids) {
        appsRecord[agentIdStr] = true
      }

      // Check if already exists
      const existing = await this.repo.findById(selection.server_id)
      if (existing) {
        // Update apps map only, do NOT re-sync
        for (const [k, v] of Object.entries(appsRecord)) {
          try {
            existing.setApp(parseAgentId(k), v)
          } catch {
            // ignore unknown agent ids
          }
        }
        existing.touch(now)
        await this.repo.save(existing)
      } else {
        const server = McpServer.create({
          id: selection.server_id,
          name,
          spec,
          apps: appsRecord,
          now,
        })
        // NOTE: intentionally does NOT call syncEnabledAgents — server already
        // exists in the agent's config file (import_selected contract).
        await this.repo.save(server)
        imported_count++
      }
    }

    return { imported_count }
  }

  // ---------------------------------------------------------------------------
  // validate_command
  // ---------------------------------------------------------------------------

  async validateCommand(command: string): Promise<{ valid: boolean }> {
    // Delegate to any MCP-capable agent's validateCommand (they all use the same
    // which/where.exe logic). Fall back to the json helper directly if no agent.
    const agents = this.agentRegistry.listByCapability('mcp')
    if (agents.length > 0) {
      const mcpSync = agents[0].asMcpSync()
      if (mcpSync) {
        const valid = await mcpSync.validateCommand(command)
        return { valid }
      }
    }
    // Fallback: inline which/where check
    const execFileAsync = promisify(execFile)
    const lookup = process.platform === 'win32' ? 'where' : 'which'
    try {
      await execFileAsync(lookup, [command])
      return { valid: true }
    } catch {
      return { valid: false }
    }
  }

  // ---------------------------------------------------------------------------
  // get_claude_mcp_status
  // ---------------------------------------------------------------------------

  async getClaudeMcpStatus(): Promise<Record<string, ClaudeStatusEntry>> {
    const result: Record<string, ClaudeStatusEntry> = {}
    const agents = this.agentRegistry.listByCapability('mcp')

    for (const agent of agents) {
      const mcpSync = agent.asMcpSync()
      if (!mcpSync) continue

      const agentId = agent.id()
      const configPath = mcpSync.configPath()
      const config_exists = existsSync(configPath)

      let server_count = 0
      if (config_exists) {
        try {
          const servers = await mcpSync.listServers()
          server_count = Object.keys(servers).length
        } catch {
          server_count = 0
        }
      }

      result[agentId] = { server_count, config_exists, config_path: configPath }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // read_agent_mcp_config
  // ---------------------------------------------------------------------------

  async readAgentMcpConfig(agentId: string): Promise<Record<string, McpServerSpec>> {
    const id = parseAgentId(agentId)
    const agent = this.agentRegistry.get(id)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }
    const mcpSync = agent.asMcpSync()
    if (!mcpSync) {
      throw new Error(`Agent ${agentId} does not support MCP`)
    }
    return mcpSync.listServers()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getMcpSync(agentId: AgentId): McpSync | undefined {
    const agent = this.agentRegistry.get(agentId)
    return agent?.asMcpSync()
  }

  private async syncEnabledAgents(server: McpServer): Promise<void> {
    for (const agentId of server.enabledAgents()) {
      const mcpSync = this.getMcpSync(agentId)
      if (mcpSync) {
        try {
          await mcpSync.upsertServer(server.id, server.spec)
        } catch {
          // best-effort — continue syncing other agents
        }
      }
    }
  }

  /**
   * Aggregate all MCP servers from all MCP-capable agents.
   * Returns a Map keyed by server id (the key used in the agent config).
   * foundIn lists the AgentId strings where the server was found.
   */
  private async aggregateFromAgents(): Promise<
    Map<string, { name: string; spec: McpServerSpec; foundIn: string[] }>
  > {
    const agents = this.agentRegistry.listByCapability('mcp')
    const aggregated = new Map<
      string,
      { name: string; spec: McpServerSpec; foundIn: string[] }
    >()

    // Track which config paths we've already read to avoid double-counting
    // agents that share a config file (gemini + gemini_cli both use
    // ~/.gemini/settings.json).
    const seenPaths = new Set<string>()

    for (const agent of agents) {
      const mcpSync = agent.asMcpSync()
      if (!mcpSync) continue

      const configPath = mcpSync.configPath()
      if (seenPaths.has(configPath)) {
        // Still record the agent as a source for already-aggregated entries
        try {
          const servers = await mcpSync.listServers()
          for (const [id] of Object.entries(servers)) {
            const entry = aggregated.get(id)
            if (entry && !entry.foundIn.includes(agent.id())) {
              entry.foundIn.push(agent.id())
            }
          }
        } catch {
          // ignore
        }
        continue
      }
      seenPaths.add(configPath)

      try {
        const servers = await mcpSync.listServers()
        for (const [id, spec] of Object.entries(servers)) {
          const existing = aggregated.get(id)
          if (existing) {
            if (!existing.foundIn.includes(agent.id())) {
              existing.foundIn.push(agent.id())
            }
          } else {
            aggregated.set(id, { name: id, spec, foundIn: [agent.id()] })
          }
        }
      } catch {
        // best-effort — skip agents whose config cannot be read
      }
    }

    return aggregated
  }
}
