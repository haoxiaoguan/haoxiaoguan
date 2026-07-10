import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { parsePlatformLoose, type PlatformId } from '../../contexts/account/domain/platform-id'

// Per-platform, per-OS candidate install locations for the editor/IDE/app each
// account platform launches into.
//
// Conventions:
//  - darwin entries are .app BUNDLE ROOTS (what we store + show); existence is
//    checked on the bundle directory.
//  - win32 entries may contain %ENV% tokens, expanded at detection time.
//  - linux entries are absolute binary paths; ~ expands to the home dir.
// The FIRST candidate for the current OS doubles as the placeholder suggestion.

type OsKey = 'darwin' | 'win32' | 'linux'

const CANDIDATES: Partial<Record<PlatformId, Record<OsKey, string[]>>> = {
  cursor: {
    darwin: ['/Applications/Cursor.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Cursor\\Cursor.exe', '%PROGRAMFILES%\\Cursor\\Cursor.exe'],
    linux: ['/usr/bin/cursor', '/opt/cursor/cursor'],
  },
  windsurf: {
    darwin: ['/Applications/Windsurf.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe'],
    linux: ['/usr/bin/windsurf', '/opt/windsurf/windsurf'],
  },
  kiro: {
    darwin: ['/Applications/Kiro.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Kiro\\Kiro.exe'],
    linux: ['/usr/bin/kiro', '/opt/kiro/kiro'],
  },
  antigravity: {
    darwin: ['/Applications/Antigravity.app'],
    win32: [
      '%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe',
      '%PROGRAMFILES%\\Antigravity\\Antigravity.exe',
    ],
    linux: ['/usr/bin/antigravity', '/opt/antigravity/antigravity', '~/.local/bin/antigravity'],
  },
  antigravity_ide: {
    darwin: ['/Applications/Antigravity IDE.app'],
    win32: [
      '%LOCALAPPDATA%\\Programs\\Antigravity IDE\\Antigravity IDE.exe',
      '%PROGRAMFILES%\\Antigravity IDE\\Antigravity IDE.exe',
    ],
    linux: ['/usr/bin/antigravity-ide', '/opt/antigravity-ide/antigravity-ide', '~/.local/bin/antigravity-ide'],
  },
  codex: {
    darwin: ['/Applications/Codex.app'],
    win32: [],
    linux: [],
  },
  zed: {
    darwin: ['/Applications/Zed.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe', '%PROGRAMFILES%\\Zed\\Zed.exe'],
    linux: ['/usr/bin/zed', '/usr/local/bin/zed', '/opt/zed/zed'],
  },
  codebuddy: {
    darwin: ['/Applications/CodeBuddy.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\CodeBuddy\\CodeBuddy.exe', '%PROGRAMFILES%\\CodeBuddy\\CodeBuddy.exe'],
    linux: ['/usr/bin/codebuddy', '/usr/local/bin/codebuddy', '/opt/codebuddy/codebuddy'],
  },
  codebuddy_cn: {
    // 真实安装名带空格 "CodeBuddy CN.app"（对照 reference process.rs）。
    darwin: ['/Applications/CodeBuddy CN.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\CodeBuddy CN\\CodeBuddy CN.exe', '%PROGRAMFILES%\\CodeBuddy CN\\CodeBuddy CN.exe'],
    linux: ['/usr/bin/codebuddycn', '/usr/local/bin/codebuddycn', '/opt/codebuddycn/codebuddycn'],
  },
  qoder: {
    darwin: ['/Applications/Qoder.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Qoder\\Qoder.exe', '%PROGRAMFILES%\\Qoder\\Qoder.exe'],
    linux: ['/usr/bin/qoder', '/usr/local/bin/qoder', '/opt/qoder/qoder'],
  },
  trae: {
    darwin: ['/Applications/Trae.app'],
    win32: ['%LOCALAPPDATA%\\Programs\\Trae\\Trae.exe', '%PROGRAMFILES%\\Trae\\Trae.exe'],
    linux: ['/usr/bin/trae', '/usr/local/bin/trae', '/opt/trae/trae'],
  },
}

function osKey(): OsKey {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

// Expand %ENV% tokens (Windows) and a leading ~ (POSIX) in a candidate path.
function expand(candidate: string): string {
  let out = candidate.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? '')
  if (out.startsWith('~')) out = homedir() + out.slice(1)
  return out
}

function candidatesFor(platform: PlatformId): string[] {
  const byOs = CANDIDATES[platform]
  if (byOs === undefined) return []
  return byOs[osKey()].map(expand).filter((p) => p.length > 0)
}

export interface AppPathInfo {
  /** First existing candidate for the current OS, or null if none found. */
  detected: string | null
  /** A representative path to show as a placeholder hint (first candidate). */
  suggestion: string
}

/**
 * Resolve the app/IDE path for a platform on the current OS: the first
 * candidate that exists on disk (detected) plus a placeholder suggestion. The
 * platform id is the frontend (kebab) form; unknown/unsupported ids yield
 * { detected: null, suggestion: '' }.
 */
export function detectAppPath(frontendPlatformId: string): AppPathInfo {
  let platform: PlatformId
  try {
    platform = parsePlatformLoose(frontendPlatformId)
  } catch {
    return { detected: null, suggestion: '' }
  }
  const candidates = candidatesFor(platform)
  const detected = candidates.find((p) => existsSync(p)) ?? null
  return { detected, suggestion: candidates[0] ?? '' }
}
