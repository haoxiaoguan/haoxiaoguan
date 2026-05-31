// Agents IPC handlers — registers the four read-only registry channels.
// Mirrors Rust agents::api (list_agents / get_agent_info /
// list_agents_by_capability / get_agent_capabilities).
//
// Channel strings follow the established "<service>:<method>" convention. They
// are declared here because the shared ipc-channels.ts is owned by the wiring
// plan; INTEGRATION must move AGENT_CHANNELS into src/shared/ipc-channels.ts and
// import it here (see manifest). The string VALUES are fixed and must not change.
//
// Arg shapes follow map_frontend_ipc.md: top-level camelCase
// ({ agentId } / { capability }). Returns are the camelCase AgentInfo DTO.
// Every handler wraps thrown errors via toIpcError so the rejection is a string.

import { ipcMain } from 'electron'
import { toIpcError } from '../../ipc/error'
import { AGENT_CHANNELS } from '../../../shared/ipc-channels'
import type { AgentRegistryService, AgentInfo } from '../application/agent-registry-service'
import { parseAgentId } from '../domain/agent-id'
import { parseCapability, type Capability } from '../domain/capability'

export { AGENT_CHANNELS }

interface AgentIdArg {
  agentId: string
}
interface CapabilityArg {
  capability: string
}

export function registerAgentHandlers(svc: AgentRegistryService): void {
  ipcMain.handle(AGENT_CHANNELS.listAgents, async (): Promise<AgentInfo[]> => {
    try {
      return svc.listAll()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(AGENT_CHANNELS.getAgentInfo, async (_e, arg: AgentIdArg): Promise<AgentInfo> => {
    try {
      const id = parseAgentId(arg.agentId)
      const info = svc.get(id)
      if (!info) throw new Error(`agent ${arg.agentId} not found`)
      return info
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    AGENT_CHANNELS.listAgentsByCapability,
    async (_e, arg: CapabilityArg): Promise<AgentInfo[]> => {
      try {
        const cap = parseCapability(arg.capability)
        return svc.listByCapability(cap)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    AGENT_CHANNELS.getAgentCapabilities,
    async (_e, arg: AgentIdArg): Promise<Capability[]> => {
      try {
        const id = parseAgentId(arg.agentId)
        const caps = svc.getCapabilities(id)
        if (!caps) throw new Error(`agent ${arg.agentId} not found`)
        return caps
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
