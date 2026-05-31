// Unit tests for McpApplicationService.
// Uses in-memory stub implementations of McpServerRepository and AgentRegistry.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { McpApplicationService } from '../../../src/main/contexts/mcp/application/mcp-application-service'
import { McpServer } from '../../../src/main/contexts/mcp/domain/mcp-server'
import type { McpServerRepository } from '../../../src/main/contexts/mcp/domain/mcp-server-repository'
import type { McpServerSpec } from '../../../src/main/contexts/mcp/domain/mcp-server'
import { AgentRegistry } from '../../../src/main/agents/domain/agent-registry'
import type { AgentClient } from '../../../src/main/agents/domain/agent-client'
import type { AgentId } from '../../../src/main/agents/domain/agent-id'
import type { AgentFamily } from '../../../src/main/agents/domain/agent-family'
import { AgentCapabilities } from '../../../src/main/agents/domain/capability'
import type { McpSync } from '../../../src/main/agents/domain/mcp-sync'

// ---- In-memory repository stub ----

class InMemoryMcpServerRepository implements McpServerRepository {
  private store = new Map<string, McpServer>()

  async findAll(): Promise<McpServer[]> {
    return Array.from(this.store.values()).sort((a, b) => a.sort_order - b.sort_order)
  }

  async findById(id: string): Promise<McpServer | null> {
    return this.store.get(id) ?? null
  }

  async save(server: McpServer): Promise<void> {
    this.store.set(server.id, server)
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }
}

// ---- McpSync stub ----

function makeMcpSync(
  configPath: string,
  initialServers: Record<string, McpServerSpec> = {},
): McpSync & { servers: Record<string, McpServerSpec> } {
  const servers: Record<string, McpServerSpec> = { ...initialServers }
  return {
    servers,
    configPath: () => configPath,
    async upsertServer(id, spec) {
      servers[id] = spec
    },
    async removeServer(id) {
      delete servers[id]
    },
    async listServers() {
      return { ...servers }
    },
    async validateCommand(cmd) {
      return cmd === 'npx'
    },
  }
}

// ---- AgentClient stub ----

function makeAgentClient(
  agentId: AgentId,
  mcpSync?: McpSync,
): AgentClient {
  const caps = mcpSync
    ? AgentCapabilities.of('mcp')
    : AgentCapabilities.none()
  return {
    id: () => agentId,
    family: (): AgentFamily => 'claude',
    displayName: () => agentId,
    capabilities: () => caps,
    hasCapability: (cap) => caps.has(cap),
    asCredentialInjection: () => undefined,
    asSkillsSync: () => undefined,
    asMcpSync: () => mcpSync,
    asSessionLogReader: () => undefined,
  }
}

// ---- Fixtures ----

const STDIO_SPEC: McpServerSpec = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'some-server'],
  env: null,
  url: null,
}

let repo: InMemoryMcpServerRepository
let claudeSync: ReturnType<typeof makeMcpSync>
let codexSync: ReturnType<typeof makeMcpSync>
let registry: AgentRegistry
let svc: McpApplicationService

beforeEach(() => {
  repo = new InMemoryMcpServerRepository()
  claudeSync = makeMcpSync('/home/user/.claude.json')
  codexSync = makeMcpSync('/home/user/.codex/config.toml')
  registry = new AgentRegistry([
    makeAgentClient('claude', claudeSync),
    makeAgentClient('codex', codexSync),
  ])
  svc = new McpApplicationService(repo, registry)
})

describe('McpApplicationService.getServers', () => {
  it('returns empty list when no servers', async () => {
    const result = await svc.getServers()
    expect(result).toEqual([])
  })

  it('returns all servers ordered by sort_order', async () => {
    const now = Math.floor(Date.now() / 1000)
    await repo.save(McpServer.create({ id: 'b', name: 'B', spec: STDIO_SPEC, sort_order: 10, now }))
    await repo.save(McpServer.create({ id: 'a', name: 'A', spec: STDIO_SPEC, sort_order: 1, now }))
    const result = await svc.getServers()
    expect(result.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('McpApplicationService.upsertServer', () => {
  it('creates a new server with generated id', async () => {
    const server = await svc.upsertServer({
      name: 'New Server',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: true },
    })
    expect(server.id).toBeTruthy()
    expect(server.name).toBe('New Server')
    expect(server.spec.command).toBe('npx')
  })

  it('syncs to enabled agents on create', async () => {
    await svc.upsertServer({
      name: 'Synced',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: true, codex: false },
    })
    // claude is enabled — should be in claudeSync
    const claudeServers = await claudeSync.listServers()
    expect(Object.keys(claudeServers)).toHaveLength(1)
    // codex is disabled — should not be in codexSync
    const codexServers = await codexSync.listServers()
    expect(Object.keys(codexServers)).toHaveLength(0)
  })

  it('updates existing server when id provided', async () => {
    const created = await svc.upsertServer({
      name: 'Original',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: true },
    })
    const updated = await svc.upsertServer({
      id: created.id,
      name: 'Updated',
      transport: 'stdio',
      command: 'node',
    })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('Updated')
    expect(updated.spec.command).toBe('node')
  })

  it('preserves created_at on update', async () => {
    const created = await svc.upsertServer({
      name: 'Original',
      transport: 'stdio',
      command: 'npx',
    })
    const originalCreatedAt = created.created_at
    // Small delay to ensure updated_at would differ
    await new Promise((r) => setTimeout(r, 10))
    await svc.upsertServer({
      id: created.id,
      name: 'Updated',
      transport: 'stdio',
      command: 'npx',
    })
    const fromRepo = await repo.findById(created.id)
    expect(fromRepo!.created_at).toBe(originalCreatedAt)
  })
})

describe('McpApplicationService.deleteServer', () => {
  it('returns false for non-existent server', async () => {
    const result = await svc.deleteServer('nonexistent')
    expect(result).toBe(false)
  })

  it('removes server from DB and enabled agent configs', async () => {
    const server = await svc.upsertServer({
      name: 'To Delete',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: true },
    })
    const serverId = server.id

    const deleted = await svc.deleteServer(serverId)
    expect(deleted).toBe(true)

    const fromRepo = await repo.findById(serverId)
    expect(fromRepo).toBeNull()

    const claudeServers = await claudeSync.listServers()
    expect(claudeServers[serverId]).toBeUndefined()
  })
})

describe('McpApplicationService.toggleApp', () => {
  it('enables an agent and syncs to its config', async () => {
    const server = await svc.upsertServer({
      name: 'Toggle Test',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: false },
    })

    await svc.toggleApp({ server_id: server.id, agent_id: 'claude', enabled: true })

    const fromRepo = await repo.findById(server.id)
    expect(fromRepo!.isEnabledFor('claude')).toBe(true)

    const claudeServers = await claudeSync.listServers()
    expect(claudeServers[server.id]).toBeDefined()
  })

  it('disables an agent and removes from its config', async () => {
    const server = await svc.upsertServer({
      name: 'Toggle Off',
      transport: 'stdio',
      command: 'npx',
      apps: { claude: true },
    })

    await svc.toggleApp({ server_id: server.id, agent_id: 'claude', enabled: false })

    const fromRepo = await repo.findById(server.id)
    expect(fromRepo!.isEnabledFor('claude')).toBe(false)

    const claudeServers = await claudeSync.listServers()
    expect(claudeServers[server.id]).toBeUndefined()
  })

  it('throws for non-existent server', async () => {
    await expect(
      svc.toggleApp({ server_id: 'missing', agent_id: 'claude', enabled: true }),
    ).rejects.toThrow('not found')
  })
})

describe('McpApplicationService.importFromApps', () => {
  it('imports servers from agent configs not yet in DB', async () => {
    claudeSync.servers['server-a'] = STDIO_SPEC
    codexSync.servers['server-b'] = { transport: 'http', command: null, args: null, env: null, url: 'http://localhost:3000' }

    const result = await svc.importFromApps()
    expect(result.imported_count).toBe(2)

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('skips servers already in DB', async () => {
    claudeSync.servers['existing-id'] = STDIO_SPEC
    const now = Math.floor(Date.now() / 1000)
    await repo.save(McpServer.create({ id: 'existing-id', name: 'Existing', spec: STDIO_SPEC, now }))

    const result = await svc.importFromApps()
    expect(result.imported_count).toBe(0)
  })

  it('populates apps map with agents where server was found', async () => {
    claudeSync.servers['shared-server'] = STDIO_SPEC
    codexSync.servers['shared-server'] = STDIO_SPEC

    await svc.importFromApps()

    const server = await repo.findById('shared-server')
    expect(server).not.toBeNull()
    // Should be found in both agents
    expect(server!.apps.get('claude')).toBe(true)
    expect(server!.apps.get('codex')).toBe(true)
  })
})

describe('McpApplicationService.scanUnmanaged', () => {
  it('returns unmanaged entries without writing to DB', async () => {
    claudeSync.servers['unmanaged-1'] = STDIO_SPEC

    const entries = await svc.scanUnmanaged()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('unmanaged-1')
    expect(entries[0].found_in).toContain('claude')

    // DB should still be empty
    const all = await repo.findAll()
    expect(all).toHaveLength(0)
  })

  it('excludes servers already in DB', async () => {
    claudeSync.servers['managed'] = STDIO_SPEC
    claudeSync.servers['unmanaged'] = STDIO_SPEC
    const now = Math.floor(Date.now() / 1000)
    await repo.save(McpServer.create({ id: 'managed', name: 'Managed', spec: STDIO_SPEC, now }))

    const entries = await svc.scanUnmanaged()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('unmanaged')
  })
})

describe('McpApplicationService.importSelected', () => {
  it('imports selected servers to DB without re-syncing to agents', async () => {
    claudeSync.servers['sel-1'] = STDIO_SPEC
    const initialClaudeCount = Object.keys(claudeSync.servers).length

    const result = await svc.importSelected({
      selections: [{ server_id: 'sel-1', agent_ids: ['claude'] }],
    })
    expect(result.imported_count).toBe(1)

    const server = await repo.findById('sel-1')
    expect(server).not.toBeNull()
    expect(server!.apps.get('claude')).toBe(true)

    // Agent config should NOT have been modified (no extra upsert)
    expect(Object.keys(claudeSync.servers)).toHaveLength(initialClaudeCount)
  })
})

describe('McpApplicationService.validateCommand', () => {
  it('returns valid:true for known command', async () => {
    const result = await svc.validateCommand('npx')
    expect(result).toEqual({ valid: true })
  })

  it('returns valid:false for unknown command', async () => {
    const result = await svc.validateCommand('nonexistent-cmd-xyz')
    expect(result).toEqual({ valid: false })
  })
})

describe('McpApplicationService.getClaudeMcpStatus', () => {
  it('returns status for all MCP-capable agents', async () => {
    const status = await svc.getClaudeMcpStatus()
    // Both agents should appear in the result
    expect(status['claude']).toBeDefined()
    expect(status['codex']).toBeDefined()
    // config_path must match what the McpSync stub reports
    expect(status['claude'].config_path).toBe('/home/user/.claude.json')
    expect(status['codex'].config_path).toBe('/home/user/.codex/config.toml')
    // config_exists reflects whether the file actually exists on disk;
    // in the test environment these paths don't exist, so server_count = 0
    expect(typeof status['claude'].server_count).toBe('number')
    expect(typeof status['claude'].config_exists).toBe('boolean')
  })

  it('reports server_count from listServers when config_exists is true', async () => {
    // Override configPath to a file that exists (use the test file itself)
    const realPath = import.meta.url.replace('file://', '')
    const syncWithRealPath = makeMcpSync(realPath, { 's1': STDIO_SPEC })
    const reg = new AgentRegistry([makeAgentClient('claude', syncWithRealPath)])
    const localSvc = new McpApplicationService(repo, reg)

    const status = await localSvc.getClaudeMcpStatus()
    expect(status['claude'].config_exists).toBe(true)
    expect(status['claude'].server_count).toBe(1)
  })
})

describe('McpApplicationService.readAgentMcpConfig', () => {
  it('returns raw config from agent', async () => {
    claudeSync.servers['raw-server'] = STDIO_SPEC

    const config = await svc.readAgentMcpConfig('claude')
    expect(config['raw-server']).toEqual(STDIO_SPEC)
  })

  it('throws for unknown agent id', async () => {
    await expect(svc.readAgentMcpConfig('unknown_agent')).rejects.toThrow()
  })

  it('throws for agent without MCP capability', async () => {
    const noMcpRegistry = new AgentRegistry([makeAgentClient('cursor')])
    const noMcpSvc = new McpApplicationService(repo, noMcpRegistry)
    await expect(noMcpSvc.readAgentMcpConfig('cursor')).rejects.toThrow('does not support MCP')
  })
})
