/**
 * Codex adapter — reads ~/.codex/sessions/[**]/*.jsonl + ~/.codex/archived_sessions/[**]/*.jsonl
 * Token values are delta-encoded (cumulative totals per file; each record stores the increment).
 * Uses saturating_sub: if counter resets/decreases the delta is 0 and the record is skipped.
 * Mirrors Rust CodexAdapter.read_usage_metrics
 */
import { join } from 'node:path'
import { dotDir } from '../../platform/persistence/paths'
import type { AgentClient, Capability, SessionLogReader } from '../shared/session-log-reader'
import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'
import { UsageRecord } from '../../contexts/usage/domain/usage-record'
import {
  collectMatchingFiles,
  fileUpdatedAt,
  isJsonlFile,
  parseRfc3339Timestamp,
  rawHash,
  readJsonLines,
  sourcePathStr,
} from '../shared/file-utils'

class CodexSessionLogReader implements SessionLogReader {
  private readonly logsRoot: string

  constructor() {
    this.logsRoot = dotDir('codex')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const sessionsDir = join(this.logsRoot, 'sessions')
    const archivedDir = join(this.logsRoot, 'archived_sessions')

    const files: string[] = []
    files.push(...collectMatchingFiles(sessionsDir, true, isJsonlFile))
    files.push(...collectMatchingFiles(archivedDir, false, isJsonlFile))
    files.sort()

    const records: UsageRecord[] = []

    for (const filePath of files) {
      const lines = readJsonLines(filePath)
      // Delta-encoding state per file
      let prevIn = 0
      let prevOut = 0
      let prevCacheR = 0
      let prevCacheC = 0

      for (const [index, raw] of lines) {
        let value: Record<string, any>
        try {
          value = JSON.parse(raw)
        } catch {
          continue
        }
        const usage = value?.response?.usage ?? {}
        const curIn: number = usage?.input_tokens ?? 0
        const curOut: number = usage?.output_tokens ?? 0
        const curCacheR: number =
          usage?.cached_input_tokens ?? usage?.cache_read_input_tokens ?? 0
        const curCacheC: number = usage?.cache_creation_input_tokens ?? 0

        // saturating_sub: clamp to 0 if counter decreased
        const dIn = Math.max(0, curIn - prevIn)
        const dOut = Math.max(0, curOut - prevOut)
        const dCr = Math.max(0, curCacheR - prevCacheR)
        const dCc = Math.max(0, curCacheC - prevCacheC)

        prevIn = curIn
        prevOut = curOut
        prevCacheR = curCacheR
        prevCacheC = curCacheC

        if (dIn === 0 && dOut === 0 && dCr === 0 && dCc === 0) continue

        const tsStr: string | undefined = value?.timestamp
        const occurredAt = tsStr ? parseRfc3339Timestamp(tsStr) : fileUpdatedAt(filePath, 0)

        records.push(
          UsageRecord.create({
            agentId: 'codex',
            sourceKind: 'session',
            sourcePath: sourcePathStr(filePath),
            sourceEventId: `${filePath}:${index}`,
            sessionId: value?.session_id ?? undefined,
            model: value?.response?.model ?? 'unknown-model',
            providerName: 'openai',
            inputTokens: dIn,
            outputTokens: dOut,
            cacheReadTokens: dCr,
            cacheCreationTokens: dCc,
            occurredAt,
            rawUpdatedAt: fileUpdatedAt(filePath, occurredAt),
            rawHash: rawHash(raw),
          }),
        )
      }
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 } }
  }
}

export class CodexAgentClient implements AgentClient {
  private readonly reader = new CodexSessionLogReader()

  id(): string {
    return 'codex'
  }

  capabilities(): Capability[] {
    return ['credential', 'skills', 'mcp', 'session_log']
  }

  asSessionLogReader(): SessionLogReader | null {
    return this.reader
  }
}
