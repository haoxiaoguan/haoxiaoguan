import { create } from 'zustand';
import { sessionsService } from '../services/tauri';
import type {
  SessionToolDto,
  SessionSummaryDto,
  SessionMessageDto,
  ToolProbeDto,
} from '@shared/api-types';

const PAGE_LIMIT = 200;
const TOOLS: SessionToolDto[] = ['claude', 'codex', 'gemini'];

interface ToolState {
  items: SessionSummaryDto[];
  total: number;
  offset: number;
  loaded: boolean;
}

interface SessionsState {
  probes: ToolProbeDto[];
  activeTool: SessionToolDto;
  byTool: Partial<Record<SessionToolDto, ToolState>>;
  // 选中会话用 sourcePath 标识（逐文件唯一）。sessionId 来自文件内容，
  // 续聊/fork 会话会跨多个文件共用同一 sessionId，不能当选中键。
  selectedPath: string | null;
  messages: SessionMessageDto[];
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  selectTool: (tool: SessionToolDto) => Promise<void>;
  loadMore: () => Promise<void>;
  selectSession: (summary: SessionSummaryDto) => Promise<void>;
  deleteSession: (summary: SessionSummaryDto) => Promise<void>;
  deleteSelected: (summaries: SessionSummaryDto[]) => Promise<void>;
  resume: (summary: SessionSummaryDto) => Promise<void>;
  refresh: () => Promise<void>;
}

function pickDefaultTool(probes: ToolProbeDto[]): SessionToolDto {
  const withData = probes.filter((p) => p.hasSessions);
  if (withData.length === 0) return 'claude';
  return withData.reduce((a, b) => ((b.lastActiveAt ?? 0) > (a.lastActiveAt ?? 0) ? b : a)).tool;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  probes: [],
  activeTool: 'claude',
  byTool: {},
  selectedPath: null,
  messages: [],
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const probes = await sessionsService.probeTools();
      const activeTool = pickDefaultTool(probes);
      set({ probes, activeTool });
      await get().selectTool(activeTool);
    } catch (e) {
      set({ error: String(e), loading: false });
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
}));

export { TOOLS };
