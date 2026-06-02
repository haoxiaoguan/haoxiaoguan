import { create } from 'zustand';
import type { ApiProxyStatus } from '@shared/api-types';
import { bridge } from '../services/bridge';

interface ApiProxyState {
  status: ApiProxyStatus;
  loading: boolean;
  error: string | null;

  fetchStatus: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useApiProxyStore = create<ApiProxyState>((set) => ({
  status: { state: 'stopped' },
  loading: false,
  error: null,

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
}));
