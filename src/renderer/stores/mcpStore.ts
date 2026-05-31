import { create } from 'zustand';
import type { McpServer, UpsertMcpServerRequest } from '../types';
import { mcpService } from '../services/tauri';

interface McpState {
  servers: McpServer[];
  loading: boolean;
  error: string | null;

  fetchServers: () => Promise<void>;
  upsertServer: (request: UpsertMcpServerRequest) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  toggleApp: (serverId: string, agentId: string, enabled: boolean) => Promise<void>;
  importFromApps: () => Promise<number>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,

  fetchServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await mcpService.getMcpServers();
      set({ servers, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  upsertServer: async (request) => {
    try {
      await mcpService.upsertMcpServer(request);
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteServer: async (serverId) => {
    try {
      await mcpService.deleteMcpServer(serverId);
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleApp: async (serverId, agentId, enabled) => {
    try {
      await mcpService.toggleMcpApp({ server_id: serverId, agent_id: agentId, enabled });
      await get().fetchServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  importFromApps: async () => {
    try {
      const result = await mcpService.importMcpFromApps();
      await get().fetchServers();
      return result.imported_count;
    } catch (e) {
      set({ error: String(e) });
      return 0;
    }
  },
}));
