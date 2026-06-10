import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
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
import type { ActivityCollectResult, RawLogEvent } from '../domain/log-event'
import {
  deriveTitle,
  extractText,
  parseTimestampToMs,
  sanitizeSessionId,
  truncateSummary,
} from '../domain/session-parse-utils'
import { mtimeMs, readHeadTailLines } from './fs-helpers'
import { patchChurn } from '../domain/code-edit-utils'

const HEAD_N = 12
const TAIL_N = 30
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function parse(line: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(line)
    return isObject(v) ? v : undefined
  } catch {
    return undefined
  }
}

export class CodexSessionSource implements SessionSource {
  readonly tool: SessionTool = 'codex'
  /** 默认跳过 subagent 子线程会话（参考行为）。container 可注入 false 改为全部显示。 */
  constructor(
    private readonly rootDir: string = dotDir('codex'),
    private readonly skipSubagents = true,
  ) {}

  roots(): string[] {
    return [join(this.rootDir, 'sessions'), join(this.rootDir, 'archived_sessions')]
  }

  private async files(): Promise<string[]> {
    const out: string[] = []
    for (const root of this.roots()) {
      if (existsSync(root)) out.push(...(await collectMatchingFilesAsync(root, true, (f) => f.endsWith('.jsonl'))))
    }
    return out
  }

  async probe(): Promise<ToolProbe> {
    const files = await this.files()
    const mtimes = await Promise.all(files.map((f) => mtimeMs(f)))
    const latest = mtimes.reduce((a, b) => (b > a ? b : a), 0)
    return { tool: this.tool, hasSessions: files.length > 0, count: files.length, lastActiveAt: latest > 0 ? latest : undefined }
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
    let head: string[]
    let tail: string[]
    try {
      ;({ head, tail } = await readHeadTailLines(path, HEAD_N, TAIL_N))
    } catch {
      return undefined
    }
    let sessionId: string | undefined
    let cwd: string | undefined
    let provider: string | undefined
    let createdAt: number | undefined
    let firstUserText: string | undefined
    for (const line of head) {
      const v = parse(line)
      if (!v) continue
      if (createdAt === undefined && typeof v.timestamp === 'string') createdAt = parseTimestampToMs(v.timestamp)
      const payload = isObject(v.payload) ? v.payload : undefined
      if (v.type === 'session_meta' && payload) {
        if (this.skipSubagents && isObject(payload.source) && 'subagent' in payload.source) return undefined
        if (!sessionId && typeof payload.id === 'string') sessionId = payload.id
        if (!cwd && typeof payload.cwd === 'string') cwd = payload.cwd
        if (!provider && typeof payload.model_provider === 'string') provider = payload.model_provider
      }
      if (!firstUserText && v.type === 'response_item' && payload && payload.type === 'message' && payload.role === 'user') {
        const text = extractText(payload.content).trim()
        if (text && !text.startsWith('# AGENTS.md') && !text.startsWith('<environment_context>')) firstUserText = text
      }
    }
    sessionId = sessionId ? sanitizeSessionId(sessionId) : sanitizeSessionId(UUID_RE.exec(basename(path))?.[0] ?? '')
    if (!sessionId) return undefined

    let summaryText: string | undefined
    let lastActiveAt: number | undefined
    for (let i = tail.length - 1; i >= 0; i--) {
      const v = parse(tail[i])
      if (!v) continue
      const payload = isObject(v.payload) ? v.payload : undefined
      if (!summaryText && v.type === 'response_item' && payload && payload.type === 'message') {
        const t = extractText(payload.content).trim()
        if (t) summaryText = t
      }
      if (lastActiveAt === undefined && typeof v.timestamp === 'string') lastActiveAt = parseTimestampToMs(v.timestamp)
    }

    return {
      tool: this.tool,
      sessionId,
      title: deriveTitle({ firstUserText, projectDir: cwd, sessionId }),
      summary: summaryText ? truncateSummary(summaryText, SUMMARY_MAX_CHARS) : undefined,
      projectDir: cwd,
      createdAt,
      lastActiveAt: lastActiveAt ?? createdAt ?? (mtime > 0 ? mtime : undefined),
      sourcePath: path,
      resumeCommand: `codex resume ${sessionId}`,
      ...(provider ? { provider } : {}),
    }
  }

  async readMessages(sourcePath: string): Promise<SessionMessage[]> {
    const text = await readTextAsync(sourcePath)
    const out: SessionMessage[] = []
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      const v = parse(line)
      if (!v || v.type !== 'response_item') continue
      const payload = isObject(v.payload) ? v.payload : undefined
      if (!payload) continue
      const ts = typeof v.timestamp === 'string' ? parseTimestampToMs(v.timestamp) : undefined
      let role: SessionMessage['role']
      let content: string
      if (payload.type === 'message') {
        role = normalizeRole(typeof payload.role === 'string' ? payload.role : 'assistant')
        content = extractText(payload.content).trim()
      } else if (payload.type === 'function_call') {
        role = 'assistant'
        const name = typeof payload.name === 'string' && payload.name ? payload.name : 'unknown'
        content = `[Tool: ${name}]`
      } else if (payload.type === 'function_call_output') {
        role = 'tool'
        content =
          typeof payload.output === 'string'
            ? payload.output.trim()
            : payload.output == null
              ? ''
              : JSON.stringify(payload.output).trim()
      } else {
        continue
      }
      if (content.length === 0) continue
      out.push({ role, content, ts })
    }
    return out
  }

  async delete(sourcePath: string): Promise<void> {
    await rm(sourcePath, { force: true })
  }

  async collectLogEvents(opts: { since?: number } = {}): Promise<ActivityCollectResult> {
    const since = opts.since ?? 0
    const files = await this.files()
    const withMtime = await Promise.all(files.map(async (f) => ({ f, m: await mtimeMs(f) })))
    let latestMtime = since
    const events: RawLogEvent[] = []
    for (const { f, m } of withMtime) {
      if (m > latestMtime) latestMtime = m
      if (m < since) continue
      let text: string
      try {
        text = await readTextAsync(f)
      } catch {
        continue
      }
      let sessionTs: number | undefined
      let isSubagent = false
      const fileToolEvents: RawLogEvent[] = []
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue
        const v = parse(line)
        if (!v) continue
        const ts = typeof v.timestamp === 'string' ? parseTimestampToMs(v.timestamp) : undefined
        if (sessionTs === undefined && ts !== undefined) sessionTs = ts
        const payload = isObject(v.payload) ? v.payload : undefined
        if (
          v.type === 'session_meta' && payload && this.skipSubagents &&
          isObject(payload.source) && 'subagent' in payload.source
        ) {
          isSubagent = true
          break
        }
        if (
          v.type === 'response_item' && payload && ts !== undefined &&
          (payload.type === 'function_call' || payload.type === 'custom_tool_call')
        ) {
          const callId =
            typeof payload.call_id === 'string' && payload.call_id
              ? payload.call_id
              : `${f}#${fileToolEvents.length}#${ts}`
          const name = typeof payload.name === 'string' ? payload.name : undefined
          fileToolEvents.push({ tool: this.tool, kind: 'tool_call', ts, sourceKey: callId, name })
          if (name === 'apply_patch') {
            const input = typeof payload.input === 'string' ? payload.input : undefined
            const churn = input ? patchChurn(input) : 0
            if (churn > 0) {
              fileToolEvents.push({ tool: this.tool, kind: 'code_edit', ts, sourceKey: callId, name, amount: churn })
            }
          }
        }
      }
      if (isSubagent) continue
      if (sessionTs !== undefined) events.push({ tool: this.tool, kind: 'session', ts: sessionTs, sourceKey: f })
      events.push(...fileToolEvents)
    }
    return { events, latestMtime }
  }
}

function normalizeRole(role: string): SessionMessage['role'] {
  if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'system') return role
  return 'assistant'
}
