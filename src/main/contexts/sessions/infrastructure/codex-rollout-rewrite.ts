import { readFile, utimes } from 'node:fs/promises'
import { statSync, existsSync } from 'node:fs'
import { atomicWrite } from '../../../platform/fs/atomic-write'

export interface RolloutRewriteResult {
  ok: boolean
  oldProvider?: string
}

/**
 * 改写 rollout 文件首行(session_meta)的 payload.model_provider。
 * 只动这一个字段,逐字节保留其余行;原子写。首行非 session_meta / 无 payload / 文件缺失 → ok:false。
 */
export async function rewriteRolloutProvider(path: string, target: string): Promise<RolloutRewriteResult> {
  if (!existsSync(path)) return { ok: false }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ok: false }
  }
  const nl = text.indexOf('\n')
  const firstLine = nl === -1 ? text : text.slice(0, nl)
  const rest = nl === -1 ? '' : text.slice(nl) // 含前导 \n
  let head: Record<string, unknown>
  try {
    head = JSON.parse(firstLine)
  } catch {
    return { ok: false }
  }
  const payload = head.payload
  if (head.type !== 'session_meta' || typeof payload !== 'object' || payload === null) return { ok: false }
  const p = payload as Record<string, unknown>
  const oldProvider = typeof p.model_provider === 'string' ? p.model_provider : undefined
  p.model_provider = target
  await atomicWrite(path, JSON.stringify(head) + rest)
  return { ok: true, oldProvider }
}

// ─── toDesktopWorkspacePath ───────────────────────────────────────────────────

/**
 * 对齐 Rust to_desktop_workspace_path:
 * - trim; 空 → undefined
 * - \\?\UNC\ 前缀 → \\ + 剩余(/ → \)
 * - \\?\ 前缀 → 去前缀(\ → /)
 * - 否则原样
 */
export function toDesktopWorkspacePath(value: string): string | undefined {
  const stripped = value.trim()
  if (stripped.length === 0) return undefined
  const lower = stripped.toLowerCase()
  if (lower.startsWith('\\\\?\\unc\\')) {
    return '\\\\' + stripped.slice(8).replace(/\//g, '\\')
  }
  if (stripped.startsWith('\\\\?\\')) {
    return stripped.slice(4).replace(/\\/g, '/')
  }
  return stripped
}

// ─── RolloutAnalysis ──────────────────────────────────────────────────────────

export interface RolloutAnalysis {
  nextText: string
  rewriteNeeded: boolean
  threadId?: string         // 首个 session_meta 的 payload.id
  cwd?: string              // 首个 session_meta 的 payload.cwd 经 toDesktopWorkspacePath
  hasUserEvent: boolean     // text 含 "user_message" 或 "user_input"
  hasEncrypted: boolean     // text 含 "encrypted_content"
  providers: string[]       // 各 session_meta 的 model_provider(缺失记 "(missing)")
  originalSessionMetaLines: string[]
  sessionMetaCount: number
}

/**
 * 全量分析并改写 rollout 文件文本。
 * 对齐 Rust rewrite_rollout_session_meta_providers:
 * - 按行保留行尾(\r\n 或 \n; 末行可能无行尾)
 * - 对每个 session_meta 行: 若 model_provider !== target → 改写并置 rewriteNeeded=true
 * - 非 session_meta 行原样保留
 */
export function analyzeRollout(text: string, target: string): RolloutAnalysis {
  const result: RolloutAnalysis = {
    nextText: '',
    rewriteNeeded: false,
    threadId: undefined,
    cwd: undefined,
    hasUserEvent: text.includes('"user_message"') || text.includes('"user_input"'),
    hasEncrypted: text.includes('"encrypted_content"'),
    providers: [],
    originalSessionMetaLines: [],
    sessionMetaCount: 0,
  }

  // split_inclusive('\n') — each segment retains its trailing \n if present
  const segments = splitInclusive(text)

  for (const segment of segments) {
    const { line, ending } = splitLineEnding(segment)

    let nextLine = line

    if (line.trim().length > 0) {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        record = null
      }
      if (
        record !== null &&
        typeof record === 'object' &&
        (record as Record<string, unknown>)['type'] === 'session_meta'
      ) {
        const rec = record as Record<string, unknown>
        const payload = rec['payload']
        if (typeof payload === 'object' && payload !== null) {
          const p = payload as Record<string, unknown>
          result.sessionMetaCount++
          result.originalSessionMetaLines.push(line)

          if (result.threadId === undefined) {
            const id = p['id']
            if (typeof id === 'string') result.threadId = id
          }
          if (result.cwd === undefined) {
            const cwd = p['cwd']
            if (typeof cwd === 'string') {
              result.cwd = toDesktopWorkspacePath(cwd)
            }
          }

          const providerVal = p['model_provider']
          const provider = typeof providerVal === 'string' ? providerVal : '(missing)'
          result.providers.push(provider)

          if (provider !== target) {
            p['model_provider'] = target
            nextLine = JSON.stringify(rec)
            result.rewriteNeeded = true
          }
        }
      }
    }

    result.nextText += nextLine + ending
  }

  return result
}

/**
 * split_inclusive('\n') — split text into segments, each retaining its trailing \n.
 * Last segment may have no trailing newline.
 */
function splitInclusive(text: string): string[] {
  if (text.length === 0) return []
  const segments: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      segments.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) {
    segments.push(text.slice(start))
  }
  return segments
}

/**
 * Split a segment into (line, ending). Ending is '\r\n', '\n', or ''.
 * The segment already has trailing \n if it came from splitInclusive.
 */
function splitLineEnding(segment: string): { line: string; ending: string } {
  if (segment.endsWith('\r\n')) {
    return { line: segment.slice(0, -2), ending: '\r\n' }
  }
  if (segment.endsWith('\n')) {
    return { line: segment.slice(0, -1), ending: '\n' }
  }
  return { line: segment, ending: '' }
}

// ─── writeRolloutPreservingMtime ──────────────────────────────────────────────

/**
 * 原子写文件，并还原 mtime（对齐 Rust restore_file_mtime，避免列表重排）。
 */
export async function writeRolloutPreservingMtime(path: string, text: string): Promise<void> {
  let originalMtime: Date | undefined
  try {
    const st = statSync(path)
    originalMtime = st.mtime
  } catch {
    originalMtime = undefined
  }
  await atomicWrite(path, text)
  if (originalMtime !== undefined) {
    try {
      await utimes(path, originalMtime, originalMtime)
    } catch {
      // best effort
    }
  }
}

// ─── rewriteRolloutLines (rollback helper) ────────────────────────────────────

/**
 * 回滚用：把文件里的 session_meta 行依次还原成 originalLines。
 * 读现文件，逐行遇 session_meta 就取下一条 original 替换，其余不动，原子写。
 */
export async function rewriteRolloutLines(path: string, originalLines: string[]): Promise<void> {
  const text = await readFile(path, 'utf8')
  const segments = splitInclusive(text)
  let origIdx = 0
  let output = ''

  for (const segment of segments) {
    const { line, ending } = splitLineEnding(segment)
    let nextLine = line

    if (line.trim().length > 0) {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        record = null
      }
      if (
        record !== null &&
        typeof record === 'object' &&
        (record as Record<string, unknown>)['type'] === 'session_meta' &&
        typeof (record as Record<string, unknown>)['payload'] === 'object' &&
        (record as Record<string, unknown>)['payload'] !== null
      ) {
        if (origIdx < originalLines.length) {
          nextLine = originalLines[origIdx++]
        }
      }
    }

    output += nextLine + ending
  }

  await atomicWrite(path, output)
}
