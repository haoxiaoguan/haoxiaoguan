import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { appSupportDir, dotDir } from '../../../platform/persistence/paths'
import { collectMatchingFilesAsync } from '../../../agents/shared/file-utils'
import type {
  SessionMessage,
  SessionPage,
  SessionSummary,
  SessionTool,
  ToolProbe,
} from '../domain/session'
import { DEFAULT_PAGE_LIMIT, type ScanOpts, type SessionSource } from '../domain/session-source'
import type { ActivityCollectResult } from '../domain/log-event'
import { parseTimestampToMs, sanitizeSessionId } from '../domain/session-parse-utils'
import { mtimeMs } from './fs-helpers'
import { ClaudeSessionSource } from './claude-session-source'

interface DesktopIndex {
  file: string
  cliSessionId: string
  title?: string | undefined
  cwd?: string | undefined
  lastActiveAt?: number | undefined
  mtime: number
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function time(v: unknown): number | undefined {
  return typeof v === 'string' ? parseTimestampToMs(v) : undefined
}

/**
 * Claude Desktop 的 Code 会话列表不是直接扫 ~/.claude/projects，而是先看 Desktop
 * 自己的 local_*.json 索引，再关联回真实 transcript。这样不会把纯 CLI 会话混进来。
 */
export class ClaudeDesktopSessionSource implements SessionSource {
  readonly tool: SessionTool = 'claude_desktop'
  private readonly delegate: ClaudeSessionSource

  constructor(
    private readonly appSupportRoot: string = appSupportDir('Claude'),
    private readonly projectsRoot: string = join(dotDir('claude'), 'projects'),
  ) {
    this.delegate = new ClaudeSessionSource(projectsRoot)
  }

  roots(): string[] {
    return [this.projectsRoot]
  }

  private codeSessionsDir(): string {
    return join(this.appSupportRoot, 'claude-code-sessions')
  }

  private async indexFiles(): Promise<string[]> {
    const root = this.codeSessionsDir()
    if (!existsSync(root)) return []
    return collectMatchingFilesAsync(root, true, (file) => basename(file).startsWith('local_') && file.endsWith('.json'))
  }

  private async transcriptMap(): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (!existsSync(this.projectsRoot)) return out
    const files = await collectMatchingFilesAsync(
      this.projectsRoot,
      true,
      (file) => file.endsWith('.jsonl') && !basename(file).startsWith('agent-'),
    )
    for (const file of files) {
      const id = sanitizeSessionId(basename(file).replace(/\.jsonl$/, ''))
      if (id.length > 0 && !out.has(id)) out.set(id, file)
    }
    return out
  }

  private async readIndex(file: string): Promise<DesktopIndex | undefined> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return undefined
    }
    if (!isObject(parsed)) return undefined
    const cliSessionId = sanitizeSessionId(
      str(parsed.cliSessionId) ?? str(parsed.cli_session_id) ?? str(parsed.sessionId) ?? '',
    )
    if (cliSessionId.length === 0) return undefined
    const mtime = await mtimeMs(file)
    return {
      file,
      cliSessionId,
      title: str(parsed.title) ?? str(parsed.name),
      cwd: str(parsed.cwd) ?? str(parsed.projectDir),
      lastActiveAt:
        time(parsed.lastActivityAt) ??
        time(parsed.updatedAt) ??
        time(parsed.createdAt) ??
        (mtime > 0 ? mtime : undefined),
      mtime,
    }
  }

  private async entries(): Promise<Array<DesktopIndex & { transcriptPath: string }>> {
    const [indexFiles, transcripts] = await Promise.all([this.indexFiles(), this.transcriptMap()])
    const bySession = new Map<string, DesktopIndex & { transcriptPath: string }>()
    for (const file of indexFiles) {
      const index = await this.readIndex(file)
      if (index === undefined) continue
      const transcriptPath = transcripts.get(index.cliSessionId)
      if (transcriptPath === undefined) continue
      const prev = bySession.get(index.cliSessionId)
      const currentTime = index.lastActiveAt ?? index.mtime
      const prevTime = prev?.lastActiveAt ?? prev?.mtime ?? 0
      if (prev === undefined || currentTime > prevTime) bySession.set(index.cliSessionId, { ...index, transcriptPath })
    }
    return [...bySession.values()].sort((a, b) => (b.lastActiveAt ?? b.mtime) - (a.lastActiveAt ?? a.mtime))
  }

  async probe(): Promise<ToolProbe> {
    const entries = await this.entries()
    const latest = entries.reduce((max, entry) => Math.max(max, entry.lastActiveAt ?? entry.mtime), 0)
    return {
      tool: this.tool,
      hasSessions: entries.length > 0,
      count: entries.length,
      lastActiveAt: latest > 0 ? latest : undefined,
    }
  }

  async scan(opts: ScanOpts = {}): Promise<SessionPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT
    const offset = opts.offset ?? 0
    const entries = await this.entries()
    const items: SessionSummary[] = []
    for (const entry of entries.slice(offset, offset + limit)) {
      const summary = await this.delegate.summarizeTranscript(entry.transcriptPath, entry.lastActiveAt ?? entry.mtime)
      if (summary === undefined) continue
      items.push({
        ...summary,
        tool: this.tool,
        sessionId: entry.cliSessionId,
        title: entry.title ?? summary.title,
        projectDir: entry.cwd ?? summary.projectDir,
        lastActiveAt: entry.lastActiveAt ?? summary.lastActiveAt,
        sourcePath: entry.transcriptPath,
        resumeCommand: `claude --resume ${entry.cliSessionId}`,
      })
    }
    return { items, total: entries.length, offset }
  }

  readMessages(sourcePath: string): Promise<SessionMessage[]> {
    return this.delegate.readMessages(sourcePath)
  }

  delete(sourcePath: string, sessionId: string): Promise<void> {
    return this.delegate.delete(sourcePath, sessionId)
  }

  async collectLogEvents(opts: { since?: number } = {}): Promise<ActivityCollectResult> {
    return { events: [], latestMtime: opts.since ?? 0 }
  }
}
