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
  collectMatchingFilesAsync,
  fileUpdatedAtAsync,
  isJsonlFile,
  parseRfc3339Timestamp,
  rawHash,
  readJsonLinesAsync,
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
    files.push(...(await collectMatchingFilesAsync(sessionsDir, true, isJsonlFile)))
    files.push(...(await collectMatchingFilesAsync(archivedDir, false, isJsonlFile)))
    files.sort()

    const records: UsageRecord[] = []

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const filePath = files[fileIdx]
      const lines = await readJsonLinesAsync(filePath)
      // Delta-encoding state per file
      let prevIn = 0
      let prevOut = 0
      let prevCacheR = 0
      let prevCacheC = 0

      // Track best-effort model name: updated whenever a line carries payload.model
      let model = 'unknown-model'

      for (const [index, raw] of lines) {
        let value: Record<string, any>
        try {
          value = JSON.parse(raw)
        } catch {
          continue
        }

        // Update model from any line that carries it (best-effort)
        const payloadModel = value?.payload?.model
        if (typeof payloadModel === 'string' && payloadModel) {
          model = payloadModel
        }

        // Token data lives in token_count events only:
        // value.payload.type === 'token_count' && value.payload.info.total_token_usage
        const tu = value?.payload?.info?.total_token_usage
        if (!tu) continue

        const curInRaw: number = tu.input_tokens ?? 0
        const curCached: number = tu.cached_input_tokens ?? 0
        const curOut: number = tu.output_tokens ?? 0
        const curReason: number = tu.reasoning_output_tokens ?? 0

        // saturating_sub: clamp to 0 if counter decreased
        const dInRaw = Math.max(0, curInRaw - prevIn)
        const dCached = Math.max(0, curCached - prevCacheR)
        const dOut = Math.max(0, curOut - prevOut)
        const dReason = Math.max(0, curReason - prevCacheC)

        prevIn = curInRaw
        prevOut = curOut
        prevCacheR = curCached
        prevCacheC = curReason

        // Normalised storage: new input = input_delta - cached_delta; cache_creation = 0
        const inputTokens = Math.max(0, dInRaw - dCached)
        const cacheReadTokens = dCached
        const outputTokens = dOut + dReason

        if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0) continue

        const tsStr: string | undefined = value?.timestamp
        const occurredAt = tsStr
          ? parseRfc3339Timestamp(tsStr)
          : await fileUpdatedAtAsync(filePath, 0)

        records.push(
          UsageRecord.create({
            agentId: 'codex',
            sourceKind: 'session',
            sourcePath: sourcePathStr(filePath),
            sourceEventId: `${filePath}:${index}`,
            sessionId: value?.session_id ?? undefined,
            model,
            providerName: 'openai',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens: 0,
            occurredAt,
            rawUpdatedAt: await fileUpdatedAtAsync(filePath, occurredAt),
            rawHash: rawHash(raw),
          }),
        )
      }

      // Yield to the event loop every 16 files to avoid blocking the Electron main process
      if ((fileIdx + 1) % 16 === 0) {
        await new Promise((r) => setImmediate(r))
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
