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
