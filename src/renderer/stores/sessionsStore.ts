import { create } from 'zustand';
import { sessionsService } from '../services/tauri';
import { bridge } from '../services/bridge';
import type {
  SessionToolDto,
  SessionSummaryDto,
  SessionMessageDto,
  ToolProbeDto,
  ClientConfigClientId,
  ClientConfigClientInfo,
  CodexRepairPreviewDto,
  CodexRepairRequestDto,
  CodexRepairResultDto,
} from '@shared/api-types';

const PAGE_LIMIT = 200;
const TOOLS: SessionToolDto[] = ['claude', 'codex', 'gemini'];

/** clientId → SessionToolDto 映射；无映射的客户端（opencode/openclaw/hermes）右侧显示「暂不支持」空态。 */
export const CLIENT_TO_TOOL: Partial<Record<ClientConfigClientId, SessionToolDto>> = {
  claude: 'claude',
  codex: 'codex',
  gemini_cli: 'gemini',
};

interface ToolState {
  items: SessionSummaryDto[];
  total: number;
  offset: number;
  loaded: boolean;
}

interface SessionsState {
  // 是否已首次初始化（probe + 默认工具加载）。模块级 store 跨导航存活，
  // 故反复进出会话页时 init 直接复用缓存、不重扫，避免每次进页都卡。
  initialized: boolean;
  probes: ToolProbeDto[];
  activeTool: SessionToolDto;
  byTool: Partial<Record<SessionToolDto, ToolState>>;
  // 选中会话用 sourcePath 标识（逐文件唯一）。sessionId 来自文件内容，
  // 续聊/fork 会话会跨多个文件共用同一 sessionId，不能当选中键。
  selectedPath: string | null;
  messages: SessionMessageDto[];
  loading: boolean;
  error: string | null;
  // 左栏客户端列表（与「客户端接入」一致的 6 个）
  clients: ClientConfigClientInfo[];
  activeClient: ClientConfigClientId;
  init: () => Promise<void>;
  selectTool: (tool: SessionToolDto) => Promise<void>;
  selectClient: (clientId: ClientConfigClientId) => Promise<void>;
  loadMore: () => Promise<void>;
  selectSession: (summary: SessionSummaryDto) => Promise<void>;
  deleteSession: (summary: SessionSummaryDto) => Promise<void>;
  deleteSelected: (summaries: SessionSummaryDto[]) => Promise<void>;
  resume: (summary: SessionSummaryDto) => Promise<void>;
  refresh: () => Promise<void>;
  repairPreview: () => Promise<CodexRepairPreviewDto>;
  repair: (req: CodexRepairRequestDto) => Promise<CodexRepairResultDto>;
  repairRollback: (backupId: string) => Promise<void>;
}

function pickDefaultTool(probes: ToolProbeDto[]): SessionToolDto {
  const withData = probes.filter((p) => p.hasSessions);
  if (withData.length === 0) return 'claude';
  return withData.reduce((a, b) => ((b.lastActiveAt ?? 0) > (a.lastActiveAt ?? 0) ? b : a)).tool;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  initialized: false,
  probes: [],
  activeTool: 'claude',
  byTool: {},
  selectedPath: null,
  messages: [],
  loading: false,
  error: null,
  clients: [],
  activeClient: 'claude',

  init: async () => {
    // 已初始化则直接复用缓存（反复进出会话页不重扫）。需要最新数据用 refresh()。
    if (get().initialized) return;
    set({ initialized: true, loading: true, error: null });
    try {
      const [probes, clients] = await Promise.all([
        sessionsService.probeTools(),
        bridge().clientConfig.clients(),
      ]);
      const activeTool = pickDefaultTool(probes);
      // 把 activeTool 映射回对应的 clientId，同步左栏高亮
      const matchedClient = (Object.entries(CLIENT_TO_TOOL).find(
        ([, tool]) => tool === activeTool,
      )?.[0] ?? 'claude') as ClientConfigClientId;
      set({ probes, clients, activeTool, activeClient: matchedClient });
      await get().selectTool(activeTool);
    } catch (e) {
      // 失败则回退 initialized，允许下次进入重试。
      set({ initialized: false, error: String(e), loading: false });
    }
  },

  selectTool: async (tool) => {
    set({ activeTool: tool, selectedPath: null, messages: [] });
    if (get().byTool[tool]?.loaded) return;
    set({ loading: true, error: null });
    try {
      const page = await sessionsService.listSessions(tool, PAGE_LIMIT, 0);
      set((s) => ({
        byTool: {
          ...s.byTool,
          [tool]: { items: page.items, total: page.total, offset: PAGE_LIMIT, loaded: true },
        },
        loading: false,
      }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectClient: async (clientId) => {
    set({ activeClient: clientId, selectedPath: null, messages: [] });
    const tool = CLIENT_TO_TOOL[clientId];
    if (tool) {
      await get().selectTool(tool);
    }
    // 无映射的客户端（opencode/openclaw/hermes）：右侧显示「暂不支持」空态，不加载会话
  },

  loadMore: async () => {
    const tool = get().activeTool;
    const cur = get().byTool[tool];
    if (!cur || cur.offset >= cur.total) return;
    set({ loading: true });
    try {
      const page = await sessionsService.listSessions(tool, PAGE_LIMIT, cur.offset);
      set((s) => {
        const prev = s.byTool[tool]!;
        return {
          byTool: {
            ...s.byTool,
            [tool]: { ...prev, items: [...prev.items, ...page.items], offset: prev.offset + PAGE_LIMIT },
          },
          loading: false,
        };
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectSession: async (summary) => {
    set({ selectedPath: summary.sourcePath, messages: [], loading: true, error: null });
    try {
      const messages = await sessionsService.getMessages(summary.tool, summary.sourcePath);
      set({ messages, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  deleteSession: async (summary) => {
    try {
      await sessionsService.deleteSession(summary.tool, summary.sourcePath, summary.sessionId);
      set((s) => {
        const cur = s.byTool[summary.tool];
        if (!cur) return {};
        return {
          byTool: {
            ...s.byTool,
            [summary.tool]: {
              ...cur,
              items: cur.items.filter((i) => i.sourcePath !== summary.sourcePath),
              total: Math.max(0, cur.total - 1),
            },
          },
          selectedPath: s.selectedPath === summary.sourcePath ? null : s.selectedPath,
          messages: s.selectedPath === summary.sourcePath ? [] : s.messages,
        };
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteSelected: async (summaries) => {
    if (summaries.length === 0) return;
    try {
      const outcomes = await sessionsService.deleteSessions(
        summaries.map((s) => ({ tool: s.tool, sourcePath: s.sourcePath, sessionId: s.sessionId })),
      );
      const removed = new Set(outcomes.filter((o) => o.ok).map((o) => o.sourcePath));
      set((s) => {
        const tool = get().activeTool;
        const cur = s.byTool[tool];
        if (!cur) return {};
        const items = cur.items.filter((i) => !removed.has(i.sourcePath));
        return {
          byTool: {
            ...s.byTool,
            [tool]: { ...cur, items, total: Math.max(0, cur.total - removed.size) },
          },
          selectedPath: s.selectedPath && removed.has(s.selectedPath) ? null : s.selectedPath,
        };
      });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  resume: async (summary) => {
    if (!summary.resumeCommand) return;
    try {
      await sessionsService.resume(summary.resumeCommand, summary.projectDir);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refresh: async () => {
    const tool = get().activeTool;
    set({ loading: true, error: null, selectedPath: null, messages: [] });
    try {
      const probes = await sessionsService.probeTools();
      const page = await sessionsService.listSessions(tool, PAGE_LIMIT, 0);
      set((s) => ({
        probes,
        byTool: { ...s.byTool, [tool]: { items: page.items, total: page.total, offset: PAGE_LIMIT, loaded: true } },
        loading: false,
      }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  repairPreview: () => sessionsService.repairPreview(),
  repair: (req) => sessionsService.repair(req),
  repairRollback: (backupId) => sessionsService.repairRollback(backupId),
}));

export { TOOLS };
