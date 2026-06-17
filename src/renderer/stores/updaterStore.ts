import { create } from 'zustand';
import type { UpdateStatus } from '@shared/api-types';
import { bridge } from '../services/bridge';

// 跨组件共享的单一 onStatus IPC 订阅（引用计数）：顶栏 UpdaterIndicator 与「关于」页都会 init，
// 这里保证全局只注册一个监听器、最后一个消费者卸载时才取消，避免重复订阅与重复 set。
let _statusUnsub: (() => void) | null = null;
let _initRefCount = 0;

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
    // 引用计数共享单一订阅：多组件 init 只注册一个 onStatus 监听器。
    _initRefCount += 1;
    if (_statusUnsub === null) {
      // 先订阅，确保订阅期间到达的事件不漏；再用主进程快照回填初始 idle，
      // 这样「下载完成后窗口被销毁重开」也能从 getStatus() 恢复 downloaded 等状态，
      // UpdaterIndicator 才能正确显示「可安装」（否则新 React 树永远停在 idle）。
      _statusUnsub = bridge().updater.onStatus((status) => set({ status }));
      void bridge()
        .updater.getStatus()
        .then((s) => set((prev) => (prev.status.state === 'idle' ? { status: s } : prev)))
        .catch(() => {});
      // 当前版本仅取一次，作 status.currentVersion 缺省时的兜底（如直接进入 error 态）。
      void bridge()
        .getVersion()
        .then((v) => set({ appVersion: v }))
        .catch(() => {});
    }
    // 返回取消函数：递减引用计数，归零时才真正取消订阅（在组件 useEffect cleanup 调用）。
    return () => {
      _initRefCount -= 1;
      if (_initRefCount <= 0) {
        _initRefCount = 0;
        _statusUnsub?.();
        _statusUnsub = null;
      }
    };
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
