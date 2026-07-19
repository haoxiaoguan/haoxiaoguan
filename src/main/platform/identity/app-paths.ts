import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parsePlatformLoose, type PlatformId } from '../../contexts/account/domain/platform-id'

const execFileAsync = promisify(execFile)

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
    // Codex→ChatGPT 改名(2026)：新装机是 ChatGPT.app，旧装机仍是 Codex.app，新优先旧回退。
    // ChatGPT.app 名字有歧义(旧聊天助手 com.openai.chat 同名)，探测时经 bundle id 校验。
    darwin: ['/Applications/ChatGPT.app', '/Applications/Codex.app'],
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

export const CODEX_MAC_BUNDLE_ID = 'com.openai.codex'

/** 候选路径的可选异步校验器：返回 false 则跳过该候选继续下一个。 */
type CandidateValidator = (path: string) => Promise<boolean>

/**
 * ChatGPT.app 候选的 bundle id 排歧义校验：改名后的 Codex App 与旧聊天助手都叫
 * ChatGPT.app，只有 CFBundleIdentifier(com.openai.codex vs com.openai.chat)能区分。
 * `defaults` 自身失败(权限等)时放行——校验只用于排歧义，最坏退回纯存在性探测。
 */
export async function verifyCodexDarwinBundle(
  appPath: string,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = execFileAsync,
): Promise<boolean> {
  try {
    const { stdout } = await exec('defaults', ['read', `${appPath}/Contents/Info`, 'CFBundleIdentifier'])
    return stdout.trim() === CODEX_MAC_BUNDLE_ID
  } catch {
    return true
  }
}

// 按平台×候选路径挂校验器；只有歧义候选才挂（Codex.app 名字无歧义，不校验）。
const DARWIN_VALIDATORS: Partial<Record<PlatformId, Record<string, CandidateValidator>>> = {
  codex: { '/Applications/ChatGPT.app': (p) => verifyCodexDarwinBundle(p) },
}

export interface AppPathInfo {
  /** First existing candidate for the current OS, or null if none found. */
  detected: string | null
  /** A representative path to show as a placeholder hint (first candidate). */
  suggestion: string
}

/**
 * Resolve the app/IDE path for a platform on the current OS: the first
 * candidate that exists on disk (detected, subject to per-candidate
 * validation) plus a placeholder suggestion. The platform id is the frontend
 * (kebab) form; unknown/unsupported ids yield { detected: null, suggestion: '' }.
 */
export async function detectAppPath(frontendPlatformId: string): Promise<AppPathInfo> {
  let platform: PlatformId
  try {
    platform = parsePlatformLoose(frontendPlatformId)
  } catch {
    return { detected: null, suggestion: '' }
  }
  const candidates = candidatesFor(platform)
  const validators = osKey() === 'darwin' ? DARWIN_VALIDATORS[platform] : undefined
  let detected: string | null = null
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const validate = validators?.[p]
    if (validate !== undefined && !(await validate(p))) continue
    detected = p
    break
  }
  return { detected, suggestion: candidates[0] ?? '' }
}
