import { create } from 'zustand';
import type { QuotaInfo } from '../types';
import { quotaService } from '../services/tauri';

interface QuotaState {
  /** Quota info keyed by account ID */
  quotas: Map<string, QuotaInfo>;
  /** Last update time per account */
  lastUpdated: Map<string, Date>;
  /** Error messages per account */
  errors: Map<string, string>;
  /** Global loading state */
  loading: boolean;

  /** Refresh quota for a single account */
  refreshQuota: (accountId: string) => Promise<void>;
  /** Refresh all quotas concurrently */
  refreshAll: () => Promise<void>;
  /** Get cached quota for an account */
  getQuota: (accountId: string) => Promise<QuotaInfo | null>;
  /** Get usage percentage for a specific model */
  getQuotaPercentage: (accountId: string, model: string) => number;
  /** Clear error for an account */
  clearError: (accountId: string) => void;
}

export const useQuotaStore = create<QuotaState>((set, get) => ({
  quotas: new Map(),
  lastUpdated: new Map(),
  errors: new Map(),
  loading: false,

  refreshQuota: async (accountId: string) => {
    set({ loading: true });
    const errors = new Map(get().errors);
    errors.delete(accountId);
    set({ errors });

    try {
      const quota = await quotaService.refreshQuota(accountId);
      const quotas = new Map(get().quotas);
      quotas.set(accountId, quota);
      const lastUpdated = new Map(get().lastUpdated);
      lastUpdated.set(accountId, new Date());
      set({ quotas, lastUpdated, loading: false });
    } catch (err) {
      const errors = new Map(get().errors);
      errors.set(accountId, String(err));
      set({ errors, loading: false });
    }
  },

  refreshAll: async () => {
    set({ loading: true });
    try {
      const results = await quotaService.refreshAll();
      const quotas = new Map(get().quotas);
      const lastUpdated = new Map(get().lastUpdated);
      const errors = new Map(get().errors);

      for (const result of results) {
        if (result.success && result.quota) {
          quotas.set(result.accountId, result.quota);
          lastUpdated.set(result.accountId, new Date());
          errors.delete(result.accountId);
        } else if (result.error) {
          errors.set(result.accountId, result.error);
        }
      }

      set({ quotas, lastUpdated, errors, loading: false });
    } catch (err) {
      set({ loading: false });
    }
  },

  getQuota: async (accountId: string) => {
    const cached = get().quotas.get(accountId);
    if (cached) return cached;

    try {
      const quota = await quotaService.getQuota(accountId);
      const quotas = new Map(get().quotas);
      quotas.set(accountId, quota);
      set({ quotas });
      return quota;
    } catch {
      return null;
    }
  },

  getQuotaPercentage: (accountId: string, model: string) => {
    const quota = get().quotas.get(accountId);
    if (!quota) return 0;
    const modelQuota = quota.models.find((m) => m.modelName === model);
    return modelQuota?.usagePercentage ?? 0;
  },

  clearError: (accountId: string) => {
    const errors = new Map(get().errors);
    errors.delete(accountId);
    set({ errors });
  },
}));
