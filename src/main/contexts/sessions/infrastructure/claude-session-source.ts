import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
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
import type { ActivityCollectResult, RawLogEvent } from '../domain/log-event'
import {
  deriveTitle,
  extractText,
  parseTimestampToMs,
  sanitizeSessionId,
  truncateSummary,
} from '../domain/session-parse-utils'
import { mtimeMs, readHeadTailLines } from './fs-helpers'
import { claudeEditChurn } from '../domain/code-edit-utils'

const HEAD_N = 12
const TAIL_N = 30

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

export class ClaudeSessionSource implements SessionSource {
  readonly tool: SessionTool = 'claude'
  constructor(private readonly rootDir: string = join(dotDir('claude'), 'projects')) {}

  roots(): string[] {
    return [this.rootDir]
  }

  private async files(): Promise<string[]> {
    if (!existsSync(this.rootDir)) return []
    return collectMatchingFilesAsync(
      this.rootDir,
      true,
      (f) => f.endsWith('.jsonl') && !basename(f).startsWith('agent-'),
    )
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
      const summary = await this.parseSummary(f, m)
      if (summary) items.push(summary)
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
    let createdAt: number | undefined
    let firstUserText: string | undefined
    for (const line of head) {
      const v = parse(line)
      if (!v) continue
      if (!sessionId && typeof v.sessionId === 'string') sessionId = v.sessionId
      if (!cwd && typeof v.cwd === 'string') cwd = v.cwd
      if (createdAt === undefined && typeof v.timestamp === 'string') createdAt = parseTimestampToMs(v.timestamp)
      if (!firstUserText) {
        const msg = isObject(v.message) ? v.message : undefined
        const isUser = v.type === 'user' || msg?.role === 'user'
        if (isUser && msg) {
          const text = extractText(msg.content).trim()
          if (text && !text.includes('<local-command-caveat>') && !text.startsWith('<command-name>')) {
            firstUserText = text
          }
        }
      }
    }
    sessionId = sessionId ? sanitizeSessionId(sessionId) : sanitizeSessionId(basename(path).replace(/\.jsonl$/, ''))
    if (!sessionId) return undefined

    let customTitle: string | undefined
    let summaryText: string | undefined
    let lastActiveAt: number | undefined
    for (let i = tail.length - 1; i >= 0; i--) {
      const v = parse(tail[i])
      if (!v) continue
      if (!customTitle && v.type === 'custom-title' && typeof v.customTitle === 'string') customTitle = v.customTitle
      if (!summaryText && v.isMeta !== true && isObject(v.message)) {
        const t = extractText(v.message.content).trim()
        if (t) summaryText = t
      }
      if (lastActiveAt === undefined && typeof v.timestamp === 'string') lastActiveAt = parseTimestampToMs(v.timestamp)
    }

    return {
      tool: this.tool,
      sessionId,
      title: deriveTitle({ customTitle, firstUserText, projectDir: cwd, sessionId }),
      summary: summaryText ? truncateSummary(summaryText, SUMMARY_MAX_CHARS) : undefined,
      projectDir: cwd,
      createdAt,
      lastActiveAt: lastActiveAt ?? createdAt ?? (mtime > 0 ? mtime : undefined),
      sourcePath: path,
      resumeCommand: `claude --resume ${sessionId}`,
    }
  }

  async readMessages(sourcePath: string): Promise<SessionMessage[]> {
    const text = await readTextAsync(sourcePath)
    const out: SessionMessage[] = []
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      const v = parse(line)
      if (!v || v.isMeta === true) continue
      const msg = isObject(v.message) ? v.message : undefined
      if (!msg) continue
      let role = typeof msg.role === 'string' ? msg.role : 'unknown'
      if (role === 'user' && Array.isArray(msg.content) && msg.content.length > 0) {
        const allToolResult = msg.content.every((it) => isObject(it) && it.type === 'tool_result')
        if (allToolResult) role = 'tool'
      }
      const content = extractText(msg.content).trim()
      if (content.length === 0) continue
      out.push({
        role: normalizeRole(role),
        content,
        ts: typeof v.timestamp === 'string' ? parseTimestampToMs(v.timestamp) : undefined,
      })
    }
    return out
  }

  async delete(sourcePath: string, sessionId: string): Promise<void> {
    const safeId = sanitizeSessionId(sessionId)
    const sidecar = join(dirname(sourcePath), safeId)
    if (safeId.length > 0 && existsSync(sidecar)) {
      await rm(sidecar, { recursive: true, force: true })
    }
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
      let sessionEmitted = false
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue
        const v = parse(line)
        if (!v || v.isMeta === true) continue
        const ts = typeof v.timestamp === 'string' ? parseTimestampToMs(v.timestamp) : undefined
        if (ts === undefined) continue
        if (!sessionEmitted) {
          events.push({ tool: this.tool, kind: 'session', ts, sourceKey: f })
          sessionEmitted = true
        }
        const msg = isObject(v.message) ? v.message : undefined
        if (v.type === 'assistant' && msg && Array.isArray(msg.content)) {
          const uuid = typeof v.uuid === 'string' ? v.uuid : undefined
          msg.content.forEach((it, idx) => {
            if (isObject(it) && it.type === 'tool_use') {
              const name = typeof it.name === 'string' ? it.name : undefined
              const sourceKey = uuid ? `${uuid}#${idx}` : `${f}#${idx}#${ts}`
              events.push({ tool: this.tool, kind: 'tool_call', ts, sourceKey, name })
              const churn = claudeEditChurn(name ?? '', it.input)
              if (churn > 0) {
                events.push({ tool: this.tool, kind: 'code_edit', ts, sourceKey, name, amount: churn })
              }
            }
          })
        }
      }
    }
    return { events, latestMtime }
  }
}

function normalizeRole(role: string): SessionMessage['role'] {
  if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'system') return role
  return 'assistant'
}
