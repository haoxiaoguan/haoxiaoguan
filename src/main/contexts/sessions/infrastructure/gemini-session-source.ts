import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { dotDir } from '../../../platform/persistence/paths'
import { collectMatchingFilesAsync, readTextAsync } from '../../../agents/shared/file-utils'
import {
  SUMMARY_MAX_CHARS,
  type SessionMessage,
  type SessionPage,
  type SessionSummary,
  type SessionTool,
  type ToolProbe,
} from '../domain/session'
import { DEFAULT_PAGE_LIMIT, type ScanOpts, type SessionSource } from '../domain/session-source'
import { deriveTitle, parseTimestampToMs, sanitizeSessionId, truncateSummary } from '../domain/session-parse-utils'
import { mtimeMs } from './fs-helpers'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isSessionFile(f: string): boolean {
  const b = basename(f)
  return b.startsWith('session-') && b.endsWith('.json')
}
/** gemini msg content：string 原样；[{text}] 数组取 text join。 */
function geminiText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((it) => (isObject(it) && typeof it.text === 'string' ? it.text : ''))
      .filter((s) => s.length > 0)
      .join('\n')
  }
  return ''
}

export class GeminiSessionSource implements SessionSource {
  readonly tool: SessionTool = 'gemini'
  constructor(private readonly tmpDir: string = join(dotDir('gemini'), 'tmp')) {}

  roots(): string[] {
    return [this.tmpDir]
  }

  private async files(): Promise<string[]> {
    if (!existsSync(this.tmpDir)) return []
    return collectMatchingFilesAsync(this.tmpDir, true, isSessionFile)
  }

  async probe(): Promise<ToolProbe> {
    const files = await this.files()
    const mtimes = await Promise.all(files.map((f) => mtimeMs(f)))
    const latest = mtimes.reduce((a, b) => (b > a ? b : a), 0)
    return { tool: this.tool, hasSessions: files.length > 0, lastActiveAt: latest > 0 ? latest : undefined }
  }

  async scan(opts: ScanOpts = {}): Promise<SessionPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT
    const offset = opts.offset ?? 0
    const files = await this.files()
    const withMtime = await Promise.all(files.map(async (f) => ({ f, m: await mtimeMs(f) })))
    withMtime.sort((a, b) => b.m - a.m)
    const pageFiles = withMtime.slice(offset, offset + limit)
    const items: SessionSummary[] = []
    for (const { f, m } of pageFiles) {
      const s = await this.parseSummary(f, m)
      if (s) items.push(s)
    }
    return { items, total: withMtime.length, offset }
  }

  private async parseSummary(path: string, mtime: number): Promise<SessionSummary | undefined> {
    let root: Record<string, unknown>
    try {
      const v = JSON.parse(await readTextAsync(path))
      if (!isObject(v)) return undefined
      root = v
    } catch {
      return undefined
    }
    const sessionId = typeof root.sessionId === 'string' ? sanitizeSessionId(root.sessionId) : ''
    if (!sessionId) return undefined
    const createdAt = parseTimestampToMs(root.startTime)
    const lastActiveAt = parseTimestampToMs(root.lastUpdated) ?? createdAt
    const messages = Array.isArray(root.messages) ? root.messages : []

    let firstUserText: string | undefined
    let summaryText: string | undefined
    for (const m of messages) {
      if (!isObject(m)) continue
      if (m.type === 'user' && !firstUserText) {
        const t = geminiText(m.content).trim()
        if (t) firstUserText = t
      }
      if (m.type === 'user' || m.type === 'gemini') {
        const t = geminiText(m.content).trim()
        if (t) summaryText = t // 末条非空消息
      }
    }

    let projectDir: string | undefined
    const rootFile = join(dirname(dirname(path)), '.project_root')
    if (existsSync(rootFile)) {
      try {
        const c = (await readFile(rootFile, 'utf8')).trim()
        if (c) projectDir = c
      } catch {
        /* ignore */
      }
    }

    return {
      tool: this.tool,
      sessionId,
      title: deriveTitle({ firstUserText, projectDir, sessionId }),
      summary: summaryText ? truncateSummary(summaryText, SUMMARY_MAX_CHARS) : undefined,
      projectDir,
      createdAt,
      lastActiveAt: lastActiveAt ?? (mtime > 0 ? mtime : undefined),
      sourcePath: path,
      resumeCommand: undefined, // Gemini CLI 命令行恢复不可靠，故不提供
    }
  }

  async readMessages(sourcePath: string): Promise<SessionMessage[]> {
    let root: Record<string, unknown>
    try {
      const v = JSON.parse(await readTextAsync(sourcePath))
      root = isObject(v) ? v : {}
    } catch {
      return []
    }
    const messages = Array.isArray(root.messages) ? root.messages : []
    const out: SessionMessage[] = []
    for (const m of messages) {
      if (!isObject(m)) continue
      let role: SessionMessage['role']
      if (m.type === 'gemini') role = 'assistant'
      else if (m.type === 'user') role = 'user'
      else continue // info / error / 其它跳过
      let content = geminiText(m.content).trim()
      if (Array.isArray(m.toolCalls)) {
        for (const call of m.toolCalls) {
          if (isObject(call) && typeof call.name === 'string' && call.name) {
            content = content.length > 0 ? `${content}\n[Tool: ${call.name}]` : `[Tool: ${call.name}]`
          }
        }
      }
      if (content.length === 0) continue
      out.push({ role, content, ts: parseTimestampToMs(m.timestamp) })
    }
    return out
  }

  async delete(sourcePath: string): Promise<void> {
    await rm(sourcePath, { force: true })
  }
}
