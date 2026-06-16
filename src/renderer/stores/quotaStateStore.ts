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
  /** 主进程 quota:updated 推送后强制重拉缓存态（绕过 ensure 的已有即跳过）。 */
  pull: (accountIds: string[]) => Promise<void>;
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
    // Coalesce into a single fetch wave + at most two commits, instead of
    // calling ensure() per account (which did 3 set()s each → up to 3N store
    // writes, each rebuilding every Map and notifying every subscriber). With
    // hundreds of accounts that storm dominated the accounts page load.
    const { states, loading } = get();
    const targets = accountIds.filter((id) => !states.has(id) && !loading.has(id));
    if (targets.length === 0) return;

    const pending = new Set(get().loading);
    targets.forEach((id) => pending.add(id));
    set({ loading: pending });

    const results = await Promise.all(
      targets.map(async (id) => {
        try {
          const state = await quotaService.getQuotaState(id);
          return { id, state, error: undefined as string | undefined };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { id, state: undefined as AccountQuotaState | undefined, error: message };
        }
      }),
    );

    const nextStates = new Map(get().states);
    const nextErrors = new Map(get().errors);
    const nextLoading = new Set(get().loading);
    for (const result of results) {
      if (result.state) {
        nextStates.set(result.id, result.state);
        nextErrors.delete(result.id);
      } else if (result.error) {
        nextErrors.set(result.id, result.error);
      }
      nextLoading.delete(result.id);
    }
    set({ states: nextStates, errors: nextErrors, loading: nextLoading });
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

  pull: async (accountIds) => {
    // 只读已持久化的 quota state(getQuotaState),不触发在线刷新;失败保留旧值。
    const results = await Promise.allSettled(
      accountIds.map(async (id) => [id, await quotaService.getQuotaState(id)] as const),
    );
    const states = new Map(get().states);
    let changed = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        states.set(r.value[0], r.value[1]);
        changed = true;
      }
    }
    if (changed) set({ states });
  },

  clear: () => set({ states: new Map(), loading: new Set(), errors: new Map() }),
}));
