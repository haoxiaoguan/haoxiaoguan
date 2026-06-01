import { describe, expect, it } from 'vitest';
import { detectPlatformShell } from '@/app/platform-shell';

describe('detectPlatformShell', () => {
  it('prefers explicit shell override for development preview', () => {
    expect(detectPlatformShell('?shell=macos', 'Mozilla/5.0 (Windows NT 10.0)')).toBe('macos');
    expect(detectPlatformShell('?shell=windows', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('windows_like');
  });

  it('falls back to macOS detection from user agent', () => {
    expect(detectPlatformShell('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macos');
    expect(detectPlatformShell('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows_like');
  });
});
