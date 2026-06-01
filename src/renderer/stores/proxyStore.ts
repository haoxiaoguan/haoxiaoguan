import { create } from 'zustand';
import type {
  ProxyDto,
  ProxyGroupDto,
  AccountBindingDto,
  ProxyImportSummary,
  ProxyTestResultDto,
  CreateProxyRequest,
  UpdateProxyRequest,
} from '@shared/api-types';
import { proxyService } from '../services/tauri';

interface ProxyState {
  proxies: ProxyDto[];
  groups: ProxyGroupDto[];
  bindings: AccountBindingDto[];
  loading: boolean;
  testingIds: Set<string>;
  error: string | null;

  fetchAll: () => Promise<void>;
  createProxy: (req: CreateProxyRequest) => Promise<void>;
  updateProxy: (id: string, patch: UpdateProxyRequest) => Promise<void>;
  deleteProxy: (id: string) => Promise<void>;
  importProxies: (text: string) => Promise<ProxyImportSummary | null>;
  testProxy: (id: string) => Promise<ProxyTestResultDto | null>;
  testProxies: (ids: string[]) => Promise<void>;
  createGroup: (name: string, proxyId: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  bindAccountToProxy: (accountId: string, proxyId: string) => Promise<void>;
  bindAccountToGroup: (accountId: string, groupId: string) => Promise<void>;
  unbindAccount: (accountId: string) => Promise<void>;
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  proxies: [],
  groups: [],
  bindings: [],
  loading: false,
  testingIds: new Set(),
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [proxies, groups, bindings] = await Promise.all([
        proxyService.listProxies(),
        proxyService.listGroups(),
        proxyService.listBindings(),
      ]);
      set({ proxies, groups, bindings, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createProxy: async (req) => {
    try {
      await proxyService.createProxy(req);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateProxy: async (id, patch) => {
    try {
      await proxyService.updateProxy(id, patch);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteProxy: async (id) => {
    try {
      await proxyService.deleteProxy(id);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  importProxies: async (text) => {
    try {
      const summary = await proxyService.importProxies(text);
      await get().fetchAll();
      return summary;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  testProxy: async (id) => {
    set((s) => ({ testingIds: new Set(s.testingIds).add(id) }));
    try {
      const result = await proxyService.testProxy(id);
      await get().fetchAll();
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    } finally {
      set((s) => {
        const next = new Set(s.testingIds);
        next.delete(id);
        return { testingIds: next };
      });
    }
  },

  testProxies: async (ids) => {
    set((s) => {
      const next = new Set(s.testingIds);
      ids.forEach((id) => next.add(id));
      return { testingIds: next };
    });
    try {
      await proxyService.testProxies(ids);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set((s) => {
        const next = new Set(s.testingIds);
        ids.forEach((id) => next.delete(id));
        return { testingIds: next };
      });
    }
  },

  createGroup: async (name, proxyId) => {
    try {
      await proxyService.createGroup(name, proxyId);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteGroup: async (id) => {
    try {
      await proxyService.deleteGroup(id);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  bindAccountToProxy: async (accountId, proxyId) => {
    try {
      await proxyService.bindAccountToProxy(accountId, proxyId);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  bindAccountToGroup: async (accountId, groupId) => {
    try {
      await proxyService.bindAccountToGroup(accountId, groupId);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  unbindAccount: async (accountId) => {
    try {
      await proxyService.unbindAccount(accountId);
      await get().fetchAll();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },
}));
