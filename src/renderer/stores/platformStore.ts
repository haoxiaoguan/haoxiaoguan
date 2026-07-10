import { create } from 'zustand';
import type { AgentId, AgentInfo, PlatformCapabilities, PlatformAction } from '../types';
import { agentService } from '../services/tauri';

interface PlatformState {
  /** Agent info list */
  platforms: AgentInfo[];
  /** Platform capabilities keyed by agent ID */
  capabilities: Map<AgentId, PlatformCapabilities>;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;

  /** Fetch all agents from backend */
  fetchPlatforms: () => Promise<void>;
  /** Get actions available for a specific agent */
  getActionsForPlatform: (agentId: AgentId) => PlatformAction[];
  /** Get display name for an agent */
  getDisplayName: (agentId: AgentId) => string;
}

/** Default agent display names (used as fallback) */
const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
  'antigravity-ide': 'Antigravity IDE',
  kiro: 'Kiro',
  'github-copilot': 'GitHub Copilot',
  codex: 'ChatGPT',
  'gemini-cli': 'Gemini CLI',
  codebuddy: 'CodeBuddy',
  'codebuddy-cn': 'CodeBuddy CN',
  qoder: 'Qoder',
  trae: 'Trae',
  zed: 'Zed',
  claude: 'Claude',
  'claude-desktop': 'Claude Desktop',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  hermes: 'Hermes',
};

export const usePlatformStore = create<PlatformState>((set, get) => ({
  platforms: [],
  capabilities: new Map(),
  loading: false,
  error: null,

  fetchPlatforms: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await agentService.listAgents();
      set({ platforms: agents, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  getActionsForPlatform: (agentId: AgentId) => {
    const caps = get().capabilities.get(agentId);
    return caps?.customActions ?? [];
  },

  getDisplayName: (agentId: AgentId) => {
    const info = get().platforms.find((p) => p.id === agentId);
    return info?.displayName ?? PLATFORM_DISPLAY_NAMES[agentId] ?? agentId;
  },
}));
