import { create } from 'zustand';
import type { AccountQuotaState } from '../types';
import { quotaService } from '../services/tauri';

interface QuotaStateStore {
  states: Map<string, AccountQuotaState>;
  loading: Set<string>;
  errors: Map<string, string>;
  ensure: (accountId: string) => Promise<void>;
  ensureMany: (accountIds: string[]) => Promise<void>;
  refresh: (accountId: string) => Promise<void>;
  clear: () => void;
}

export const useQuotaStateStore = create<QuotaStateStore>((set, get) => ({
  states: new Map(),
  loading: new Set(),
  errors: new Map(),

  ensure: async (accountId) => {
    if (get().states.has(accountId) || get().loading.has(accountId)) return;
    const loading = new Set(get().loading);
    loading.add(accountId);
    set({ loading });
    try {
      const state = await quotaService.getQuotaState(accountId);
      const states = new Map(get().states);
      const errors = new Map(get().errors);
      states.set(accountId, state);
      errors.delete(accountId);
      set({ states, errors });
    } catch (error) {
      const errors = new Map(get().errors);
      errors.set(accountId, error instanceof Error ? error.message : String(error));
      set({ errors });
    } finally {
      const next = new Set(get().loading);
      next.delete(accountId);
      set({ loading: next });
    }
  },

  ensureMany: async (accountIds) => {
    await Promise.all(accountIds.map((id) => get().ensure(id)));
  },

  refresh: async (accountId) => {
    const loading = new Set(get().loading);
    loading.add(accountId);
    set({ loading });
    try {
      const state = await quotaService.refreshQuotaState(accountId);
      const states = new Map(get().states);
      const errors = new Map(get().errors);
      states.set(accountId, state);
      errors.delete(accountId);
      set({ states, errors });
    } catch (error) {
      const errors = new Map(get().errors);
      errors.set(accountId, error instanceof Error ? error.message : String(error));
      set({ errors });
      // 重新抛出:调用方据此弹出错误提示并标记卡片失败态(刷新失败不再被静默吞掉)
      throw error;
    } finally {
      const next = new Set(get().loading);
      next.delete(accountId);
      set({ loading: next });
    }
  },

  clear: () => set({ states: new Map(), loading: new Set(), errors: new Map() }),
}));
