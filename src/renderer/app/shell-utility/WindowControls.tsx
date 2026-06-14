import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';

import { bridge } from '../../services/bridge';

/**
 * 自绘窗口控制（Windows/Linux）—— 无原生标题栏(titleBarStyle:'hidden')时，在 header 右侧
 * 画 min/max/close，与应用风格协调、两平台一套。macOS 不渲染本组件(用系统红绿灯)。
 *
 * header 为 -webkit-app-region:drag 可拖拽区，这些按钮显式 no-drag 才可点击。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bridge()
      .windowControls.isMaximized()
      .then((v) => {
        if (!cancelled) setMaximized(v);
      })
      .catch(() => {});
    const unsub = bridge().windowControls.onMaximizeChanged(setMaximized);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const baseBtn =
    'no-drag inline-flex h-full w-[46px] shrink-0 items-center justify-center text-foreground/70 transition-colors focus-visible:outline-none';

  return (
    // -mr-4 抵消 header 的 px-4 右内边距，让按钮贴到卡片右边缘（圆角由卡片 overflow-hidden 裁切）。
    <div className="no-drag -mr-4 ml-1 flex h-full items-stretch" data-tauri-no-drag>
      <button
        type="button"
        aria-label="最小化"
        className={`${baseBtn} hover:bg-accent hover:text-foreground`}
        onClick={() => void bridge().windowControls.minimize()}
      >
        <Minus className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={maximized ? '向下还原' : '最大化'}
        className={`${baseBtn} hover:bg-accent hover:text-foreground`}
        onClick={() => void bridge().windowControls.maximizeToggle()}
      >
        {maximized ? (
          <Copy className="size-[13px]" strokeWidth={1.75} aria-hidden />
        ) : (
          <Square className="size-[13px]" strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <button
        type="button"
        aria-label="关闭"
        className={`${baseBtn} hover:bg-[#e81123] hover:text-white`}
        onClick={() => void bridge().windowControls.close()}
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
