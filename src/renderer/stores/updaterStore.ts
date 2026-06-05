import { create } from 'zustand';
import type { UpdateStatus } from '@shared/api-types';
import { bridge } from '../services/bridge';

interface UpdaterState {
  status: UpdateStatus;
  dialogOpen: boolean;

  /** 订阅主进程更新状态推送。返回取消订阅函数（在组件 useEffect cleanup 调用）。 */
  init: () => () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: { state: 'idle' },
  dialogOpen: false,

  init: () => {
    return bridge().updater.onStatus((status) => set({ status }));
  },

  check: async () => {
    try {
      await bridge().updater.check();
    } catch (e) {
      set({ status: { state: 'error', error: String(e) } });
    }
  },

  download: async () => {
    try {
      await bridge().updater.download();
    } catch (e) {
      set({ status: { state: 'error', error: String(e) } });
    }
  },

  install: async () => {
    // quitAndInstall 会退出并重启，正常情况下不返回。
    try {
      await bridge().updater.install();
    } catch (e) {
      set({ status: { state: 'error', error: String(e) } });
    }
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));
