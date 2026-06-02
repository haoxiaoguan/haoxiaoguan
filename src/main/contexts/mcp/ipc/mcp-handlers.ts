// registerMcpHandlers — wires all 10 MCP IPC channels.
// Channel names come from MCP_CHANNELS in src/shared/ipc-channels.ts.
// Arg/return shapes are fixed by the frontend contract (map_mcp.md).
//
// Arg casing rules (from CONVENTIONS.md §3 + map_mcp.md):
//   - Top-level args: camelCase  (command, agentId, serverId)
//   - Channels with a `request` wrapper: inner fields are snake_case
//     (upsert_mcp_server, toggle_mcp_app, import_selected_mcp)
//
// Return casing: snake_case.

import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { MCP_CHANNELS } from '../../../../shared/ipc-channels'
import type { McpApplicationService } from '../application/mcp-application-service'

interface UpsertMcpServerRequest {
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

interface ToggleMcpAppRequest {
  server_id: string
  agent_id: string
  enabled: boolean
}

interface ImportSelectedMcpRequest {
  selections: Array<{ server_id: string; agent_ids: string[] }>
}

export function registerMcpHandlers(svc: McpApplicationService): void {
  // 1. get_mcp_servers — no args
  ipcMain.handle(MCP_CHANNELS.getMcpServers, async () => {
    try {
      const servers = await svc.getServers()
      return servers.map((s) => s.toDto())
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 2. upsert_mcp_server — request wrapper with snake_case inner fields
  ipcMain.handle(MCP_CHANNELS.upsertMcpServer, async (_e, req: UpsertMcpServerRequest) => {
    try {
      const server = await svc.upsertServer({
        id: req.id,
        name: req.name,
        description: req.description,
        transport: req.transport,
        command: req.command,
        args: req.args,
        env: req.env,
        url: req.url,
        apps: req.apps,
        homepage: req.homepage,
        docs: req.docs,
        tags: req.tags,
      })
      return server.toDto()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 3. delete_mcp_server — top-level camelCase arg: server_id (snake_case per map)
  ipcMain.handle(MCP_CHANNELS.deleteMcpServer, async (_e, server_id: string) => {
    try {
      return await svc.deleteServer(server_id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 4. toggle_mcp_app — request wrapper with snake_case inner fields
  ipcMain.handle(MCP_CHANNELS.toggleMcpApp, async (_e, req: ToggleMcpAppRequest) => {
    try {
      await svc.toggleApp({
        server_id: req.server_id,
        agent_id: req.agent_id,
        enabled: req.enabled,
      })
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 5. import_mcp_from_apps — no args
  ipcMain.handle(MCP_CHANNELS.importMcpFromApps, async () => {
    try {
      return await svc.importFromApps()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 6. validate_mcp_command — top-level camelCase arg: command
  ipcMain.handle(MCP_CHANNELS.validateMcpCommand, async (_e, command: string) => {
    try {
      return await svc.validateCommand(command)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 7. get_claude_mcp_status — no args
  ipcMain.handle(MCP_CHANNELS.getClaudeMcpStatus, async () => {
    try {
      return await svc.getClaudeMcpStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 8. read_agent_mcp_config — top-level camelCase arg: agent_id (snake_case per map)
  ipcMain.handle(MCP_CHANNELS.readAgentMcpConfig, async (_e, agent_id: string) => {
    try {
      return await svc.readAgentMcpConfig(agent_id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 9. scan_unmanaged_mcp — no args
  ipcMain.handle(MCP_CHANNELS.scanUnmanagedMcp, async () => {
    try {
      return await svc.scanUnmanaged()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 10. import_selected_mcp — request wrapper with snake_case inner fields
  ipcMain.handle(MCP_CHANNELS.importSelectedMcp, async (_e, req: ImportSelectedMcpRequest) => {
    try {
      return await svc.importSelected({ selections: req.selections })
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
