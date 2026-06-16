export type PlatformShell = 'macos' | 'windows_like';

export function detectPlatformShell(
  search = '',
  userAgent = navigator.userAgent,
): PlatformShell {
  const shell = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    .get('shell')
    ?.toLowerCase();

  if (shell === 'macos') {
    return 'macos';
  }

  if (shell === 'windows' || shell === 'windows_like') {
    return 'windows_like';
  }

  return /mac/i.test(userAgent) ? 'macos' : 'windows_like';
}

/**
 * 是否为真正的 Windows —— Windows 用系统原生标题栏覆盖按钮(titleBarOverlay)、内容贴边、
 * header 更矮；Linux 同属 windows_like 但 titleBarOverlay 不支持，仍走 header 自绘按钮、
 * 保持浮动卡片布局。故 Windows 专属外观以本判定为准。
 */
export function isWindowsChrome(userAgent = navigator.userAgent): boolean {
  return /windows/i.test(userAgent);
}
