import { create } from 'zustand';
import type { UpdateStatus } from '@shared/api-types';
import { bridge } from '../services/bridge';

interface UpdaterState {
  status: UpdateStatus;
  dialogOpen: boolean;
  /** 当前应用版本（init 时取一次），作 status.currentVersion 缺省时的兜底。 */
  appVersion: string;

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
  appVersion: '',

  init: () => {
    // 先订阅，确保订阅期间到达的事件不漏；再用主进程快照回填初始 idle，
    // 这样「下载完成后窗口被销毁重开」也能从 getStatus() 恢复 downloaded 等状态，
    // UpdaterIndicator 才能正确显示「可安装」（否则新 React 树永远停在 idle）。
    const unsub = bridge().updater.onStatus((status) => set({ status }));
    void bridge()
      .updater.getStatus()
      .then((s) => set((prev) => (prev.status.state === 'idle' ? { status: s } : prev)))
      .catch(() => {});
    // 当前版本仅取一次，作 status.currentVersion 缺省时的兜底（如直接进入 error 态）。
    void bridge()
      .getVersion()
      .then((v) => set({ appVersion: v }))
      .catch(() => {});
    return unsub;
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
