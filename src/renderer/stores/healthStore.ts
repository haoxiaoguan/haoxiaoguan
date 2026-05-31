/**
 * healthStore — 账号健康（validation + quota）状态缓存。
 *
 * 缓存按 accountId 索引，UI 渲染 HealthChip / QuotaChip 时直接读，
 * 后台 batch refresh 后写入。
 */
import { create } from 'zustand';
import { healthService, type HealthSnapshot } from '../services/tauri';

interface HealthState {
  snapshots: Map<string, HealthSnapshot>;
  refreshing: Set<string>;
  lastBatchAt: number | null;

  refresh: (accountId: string) => Promise<void>;
  refreshBatch: (accountIds: string[], concurrency?: number) => Promise<void>;
  clear: () => void;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  snapshots: new Map(),
  refreshing: new Set(),
  lastBatchAt: null,

  refresh: async (accountId) => {
    const refreshing = new Set(get().refreshing);
    refreshing.add(accountId);
    set({ refreshing });

    try {
      const snap = await healthService.getAccountHealth(accountId);
      const snapshots = new Map(get().snapshots);
      snapshots.set(accountId, snap);
      set({ snapshots });
    } finally {
      const next = new Set(get().refreshing);
      next.delete(accountId);
      set({ refreshing: next });
    }
  },

  refreshBatch: async (accountIds, concurrency = 4) => {
    if (accountIds.length === 0) return;
    const refreshing = new Set(get().refreshing);
    accountIds.forEach((id) => refreshing.add(id));
    set({ refreshing });

    try {
      const results = await healthService.validateBatch(accountIds, concurrency);
      const snapshots = new Map(get().snapshots);
      for (const r of results) {
        if ('result' in r) {
          snapshots.set(r.account_id, {
            account_id: r.account_id,
            validation: r.result,
            quota: undefined,
            checked_at: r.result.checked_at,
          });
        }
      }
      set({ snapshots, lastBatchAt: Date.now() });
    } finally {
      const next = new Set(get().refreshing);
      accountIds.forEach((id) => next.delete(id));
      set({ refreshing: next });
    }
  },

  clear: () => set({ snapshots: new Map(), refreshing: new Set(), lastBatchAt: null }),
}));
