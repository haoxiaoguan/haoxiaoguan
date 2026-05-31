// Session-log readers — full domain/SessionLogReader implementations for the
// five session_log-capable agents. Each faithfully ports its Rust adapter's
// read_usage_metrics parsing (field names, delta-encoding, token math).
//
// These implement the canonical agents/domain/session-log-reader.ts contract
// (logsRoot/listSessionFiles/readUsageMetrics/readSessionMeta). The separate
// agents/<id>/<id>-agent.ts files implement the leaner shared interface used by
// the already-wired usage context; both coexist intentionally.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionLogReader } from '../../domain/session-log-reader'
import type { SessionMeta } from '../../domain/session-meta'
import type { UsageCursor, UsageMetricsBatch, UsageRecord } from '../../domain/usage-metrics'
import { defaultUsageCursor } from '../../domain/usage-metrics'
import {
  collectMatchingFiles,
  fileUpdatedAt,
  isJsonlFile,
  parseRfc3339Timestamp,
  rawHash,
  readJsonLines,
  readText,
  sourcePathStr,
} from './jsonl-reader'
import { dotDir, appSupportDir } from './path-resolver'
import { AgentError } from '../../domain/agent-error'

const EMPTY_BATCH = (): UsageMetricsBatch => ({ records: [], nextCursor: defaultUsageCursor() })

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function occurredAtFrom(value: Record<string, unknown>, filePath: string): number {
  const ts = str(value.timestamp)
  return ts !== undefined ? parseRfc3339Timestamp(ts) : fileUpdatedAt(filePath, 0)
}

// ── Claude Code: ~/.claude/projects/**/*.jsonl ──────────────────────────────
export class ClaudeSessionLogReader implements SessionLogReader {
  logsRoot(): string {
    return join(dotDir('claude'), 'projects')
  }
  async listSessionFiles(): Promise<string[]> {
    const root = this.logsRoot()
    return existsSync(root) ? collectMatchingFiles(root, true, isJsonlFile) : []
  }
  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await this.listSessionFiles()
    const records: UsageRecord[] = []
    for (const path of files) {
      for (const [index, raw] of readJsonLines(path)) {
        const value = parseLine(raw, path, index)
        const message = asObject(value.message)
        const usage = asObject(message?.usage)
        if (!hasUsageTokens(usage)) continue
        records.push({
          agentId: 'claude',
          sourceKind: 'session',
          sourcePath: sourcePathStr(path),
          sourceEventId: `${path}:${index}`,
          sessionId: str(value.sessionId),
          model: str(message?.model) ?? 'unknown-model',
          providerName: 'anthropic',
          inputTokens: num(usage?.input_tokens),
          outputTokens: num(usage?.output_tokens),
          cacheReadTokens: num(usage?.cache_read_input_tokens),
          cacheCreationTokens: num(usage?.cache_creation_input_tokens),
          occurredAt: occurredAtFrom(value, path),
          rawUpdatedAt: fileUpdatedAt(path, occurredAtFrom(value, path)),
          rawHash: rawHash(raw),
        })
      }
    }
    return { records, nextCursor: defaultUsageCursor() }
  }
  async readSessionMeta(): Promise<SessionMeta[]> {
    return []
  }
}

function hasUsageTokens(usage: Record<string, unknown> | undefined): boolean {
  if (!usage) return false
  return ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some(
    (f) => typeof usage[f] === 'number',
  )
}

// ── Codex: ~/.codex/sessions/**/*.jsonl + archived_sessions/*.jsonl ──────────
// Cumulative-delta token counts: subtract previous line's running totals.
export class CodexSessionLogReader implements SessionLogReader {
  logsRoot(): string {
    return dotDir('codex')
  }
  async listSessionFiles(): Promise<string[]> {
    const root = this.logsRoot()
    const files: string[] = []
    const sessions = join(root, 'sessions')
    if (existsSync(sessions)) files.push(...collectMatchingFiles(sessions, true, isJsonlFile))
    const archived = join(root, 'archived_sessions')
    if (existsSync(archived)) files.push(...collectMatchingFiles(archived, false, isJsonlFile))
    files.sort()
    return files
  }
  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await this.listSessionFiles()
    const records: UsageRecord[] = []
    for (const path of files) {
      let prevIn = 0
      let prevOut = 0
      let prevCacheR = 0
      let prevCacheC = 0
      for (const [index, raw] of readJsonLines(path)) {
        const value = parseLine(raw, path, index)
        const usage = asObject(asObject(value.response)?.usage) ?? {}
        const curIn = num(usage.input_tokens)
        const curOut = num(usage.output_tokens)
        const curCacheR = num(usage.cached_input_tokens ?? usage.cache_read_input_tokens)
        const curCacheC = num(usage.cache_creation_input_tokens)
        const dIn = Math.max(0, curIn - prevIn)
        const dOut = Math.max(0, curOut - prevOut)
        const dCr = Math.max(0, curCacheR - prevCacheR)
        const dCc = Math.max(0, curCacheC - prevCacheC)
        prevIn = curIn
        prevOut = curOut
        prevCacheR = curCacheR
        prevCacheC = curCacheC
        if (dIn === 0 && dOut === 0 && dCr === 0 && dCc === 0) continue
        records.push({
          agentId: 'codex',
          sourceKind: 'session',
          sourcePath: sourcePathStr(path),
          sourceEventId: `${path}:${index}`,
          sessionId: str(value.session_id),
          model: str(asObject(value.response)?.model) ?? 'unknown-model',
          providerName: 'openai',
          inputTokens: dIn,
          outputTokens: dOut,
          cacheReadTokens: dCr,
          cacheCreationTokens: dCc,
          occurredAt: occurredAtFrom(value, path),
          rawUpdatedAt: fileUpdatedAt(path, occurredAtFrom(value, path)),
          rawHash: rawHash(raw),
        })
      }
    }
    return { records, nextCursor: defaultUsageCursor() }
  }
  async readSessionMeta(): Promise<SessionMeta[]> {
    return []
  }
}

// ── Gemini CLI: ~/.gemini/tmp/session-*.json (JSON w/ events[] array) ────────
// output = tokens.output + tokens.thoughts.
export class GeminiCliSessionLogReader implements SessionLogReader {
  logsRoot(): string {
    return join(dotDir('gemini'), 'tmp')
  }
  async listSessionFiles(): Promise<string[]> {
    const root = this.logsRoot()
    return existsSync(root) ? collectMatchingFiles(root, true, isGeminiSessionFile) : []
  }
  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await this.listSessionFiles()
    const records: UsageRecord[] = []
    for (const path of files) {
      const raw = readText(path)
      const value = parseWhole(raw, path)
      const events = Array.isArray(value.events) ? (value.events as unknown[]) : null
      if (!events) continue
      for (let index = 0; index < events.length; index++) {
        const event = asObject(events[index]) ?? {}
        const tokens = asObject(event.tokens) ?? {}
        const ts = str(event.timestamp)
        const occurredAt = ts !== undefined ? parseRfc3339Timestamp(ts) : fileUpdatedAt(path, 0)
        const output = num(tokens.output) + num(tokens.thoughts)
        records.push({
          agentId: 'gemini_cli',
          sourceKind: 'session',
          sourcePath: sourcePathStr(path),
          sourceEventId: `${path}:${index}`,
          sessionId: str(event.sessionId),
          model: str(event.model) ?? 'unknown-model',
          providerName: 'google',
          inputTokens: num(tokens.input),
          outputTokens: output,
          cacheReadTokens: num(tokens.cached),
          cacheCreationTokens: 0,
          occurredAt,
          rawUpdatedAt: fileUpdatedAt(path, occurredAt),
          rawHash: rawHash(raw),
        })
      }
    }
    return { records, nextCursor: defaultUsageCursor() }
  }
  async readSessionMeta(): Promise<SessionMeta[]> {
    return []
  }
}

function isGeminiSessionFile(filePath: string): boolean {
  const name = baseName(filePath)
  return name.startsWith('session-') && name.endsWith('.json')
}

// ── Kiro: single tokens_generated.jsonl (promptTokens/generatedTokens) ───────
export class KiroSessionLogReader implements SessionLogReader {
  logsRoot(): string {
    return join(appSupportDir('Kiro'), 'User', 'globalStorage', 'kiro.kiroagent', 'dev_data')
  }
  private logFile(): string {
    return join(this.logsRoot(), 'tokens_generated.jsonl')
  }
  async listSessionFiles(): Promise<string[]> {
    const f = this.logFile()
    return existsSync(f) ? [f] : []
  }
  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const path = this.logFile()
    if (!existsSync(path)) return EMPTY_BATCH()
    const fallback = fileUpdatedAt(path, 0)
    const records: UsageRecord[] = []
    for (const [index, raw] of readJsonLines(path)) {
      const value = parseLine(raw, path, index)
      const ts = str(value.timestamp)
      const occurredAt = ts !== undefined ? parseRfc3339Timestamp(ts) : fallback
      records.push({
        agentId: 'kiro',
        sourceKind: 'session',
        sourcePath: sourcePathStr(path),
        sourceEventId: `kiro-${index}`,
        sessionId: str(value.sessionId),
        model: str(value.model) ?? 'unknown-model',
        providerName: 'kiro',
        inputTokens: num(value.promptTokens),
        outputTokens: num(value.generatedTokens),
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        occurredAt,
        rawUpdatedAt: fileUpdatedAt(path, occurredAt),
        rawHash: rawHash(raw),
      })
    }
    return { records, nextCursor: defaultUsageCursor() }
  }
  async readSessionMeta(): Promise<SessionMeta[]> {
    return []
  }
}

// ── Qoder: projects/**/task-*.session.execution-session.json ─────────────────
export class QoderSessionLogReader implements SessionLogReader {
  logsRoot(): string {
    return join(appSupportDir('Qoder'), 'SharedClientCache', 'cli', 'projects')
  }
  async listSessionFiles(): Promise<string[]> {
    return collectMatchingFiles(this.logsRoot(), true, isQoderSessionFile)
  }
  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await this.listSessionFiles()
    const records: UsageRecord[] = []
    for (const path of files) {
      const raw = readText(path)
      const value = parseWhole(raw, path)
      const occurredAt = occurredAtFrom(value, path)
      records.push({
        agentId: 'qoder',
        sourceKind: 'session',
        sourcePath: sourcePathStr(path),
        sourceEventId: str(value.id) ?? 'qoder-event',
        sessionId: str(value.session_id),
        model: str(value.model) ?? 'unknown-model',
        providerName: 'qoder',
        inputTokens: num(value.prompt_tokens),
        outputTokens: num(value.completion_tokens),
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        occurredAt,
        rawUpdatedAt: fileUpdatedAt(path, occurredAt),
        rawHash: rawHash(raw),
      })
    }
    return { records, nextCursor: defaultUsageCursor() }
  }
  async readSessionMeta(): Promise<SessionMeta[]> {
    return []
  }
}

function isQoderSessionFile(filePath: string): boolean {
  const name = baseName(filePath)
  return name.startsWith('task-') && name.endsWith('.session.execution-session.json')
}

// ── shared parse helpers ─────────────────────────────────────────────────────
function parseLine(raw: string, path: string, index: number): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return asObject(v) ?? {}
  } catch (e) {
    throw AgentError.configParse(path, `line ${index + 1}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
function parseWhole(raw: string, path: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return asObject(v) ?? {}
  } catch (e) {
    throw AgentError.configParse(path, e instanceof Error ? e.message : String(e))
  }
}
function asObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function baseName(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  return norm.slice(norm.lastIndexOf('/') + 1)
}
