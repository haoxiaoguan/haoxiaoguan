import { create } from 'zustand';
import type {
  ApiProxyStatus,
  ApiProxyKeyMeta,
  AccountPoolHealthRow,
  RouteComboDto,
  RouteComboInputDto,
} from '@shared/api-types';
import { bridge } from '../services/bridge';

interface ApiProxyState {
  status: ApiProxyStatus;
  loading: boolean;
  error: string | null;
  keys: ApiProxyKeyMeta[];
  newPlaintext: string | null;
  poolHealth: AccountPoolHealthRow[];
  combos: RouteComboDto[];
  routableModels: string[];

  fetchStatus: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  fetchKeys: () => Promise<void>;
  createKey: (name: string) => Promise<void>;
  setKeyActive: (id: string, isActive: boolean) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  clearNewPlaintext: () => void;
  fetchPoolHealth: () => Promise<void>;
  clearSuspension: (accountId: string) => Promise<void>;
  fetchCombos: () => Promise<void>;
  fetchRoutableModels: () => Promise<void>;
  createCombo: (input: RouteComboInputDto) => Promise<boolean>;
  updateCombo: (id: string, patch: Partial<RouteComboInputDto>) => Promise<boolean>;
  deleteCombo: (id: string) => Promise<void>;
}

export const useApiProxyStore = create<ApiProxyState>((set, get) => ({
  status: { state: 'stopped' },
  loading: false,
  error: null,
  keys: [],
  newPlaintext: null,
  poolHealth: [],
  combos: [],
  routableModels: [],

  fetchStatus: async () => {
    try {
      const status = await bridge().apiProxy.getStatus();
      set({ status, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  start: async () => {
    set({ loading: true, error: null });
    try {
      const status = await bridge().apiProxy.start();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  stop: async () => {
    set({ loading: true, error: null });
    try {
      const status = await bridge().apiProxy.stop();
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchKeys: async () => {
    try {
      set({ keys: await bridge().apiProxy.listClientKeys() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createKey: async (name: string) => {
    try {
      const { plaintext } = await bridge().apiProxy.createClientKey(name);
      set({ newPlaintext: plaintext });
      await get().fetchKeys();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setKeyActive: async (id: string, isActive: boolean) => {
    try {
      await bridge().apiProxy.setClientKeyActive(id, isActive);
      await get().fetchKeys();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteKey: async (id: string) => {
    try {
      await bridge().apiProxy.deleteClientKey(id);
      await get().fetchKeys();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearNewPlaintext: () => set({ newPlaintext: null }),

  fetchPoolHealth: async () => {
    try {
      set({ poolHealth: await bridge().apiProxy.getAccountPoolHealth() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearSuspension: async (accountId: string) => {
    try {
      await bridge().apiProxy.clearAccountSuspension(accountId);
      await get().fetchPoolHealth();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchCombos: async () => {
    try {
      set({ combos: await bridge().apiProxy.listCombos() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchRoutableModels: async () => {
    try {
      set({ routableModels: await bridge().apiProxy.listRoutableModels() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // create/update 返回成功与否，供 UI 决定是否关闭编辑器（失败保留表单 + 弹错）。
  createCombo: async (input: RouteComboInputDto) => {
    try {
      await bridge().apiProxy.createCombo(input);
      await get().fetchCombos();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  updateCombo: async (id: string, patch: Partial<RouteComboInputDto>) => {
    try {
      await bridge().apiProxy.updateCombo(id, patch);
      await get().fetchCombos();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  deleteCombo: async (id: string) => {
    try {
      await bridge().apiProxy.deleteCombo(id);
      await get().fetchCombos();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
