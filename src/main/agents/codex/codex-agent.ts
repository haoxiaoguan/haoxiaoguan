/**
 * Codex adapter — reads ~/.codex/sessions/[**]/*.jsonl + ~/.codex/archived_sessions/[**]/*.jsonl
 * Token values are delta-encoded (cumulative totals per file; each record stores the increment).
 * Uses saturating_sub: if counter resets/decreases the delta is 0 and the record is skipped.
 * Mirrors Rust CodexAdapter.read_usage_metrics
 *
 * 健壮性：单个文件读取/解析失败（~/.codex 体量大、可能有超出 V8 字符串上限的巨型 session
 * 文件）只跳过该文件，不让整个 codex 同步抛错归零。
 * 增量：注入 UsageFileCursorStore 后跳过 mtime 未变的文件（历史 session 文件不再重复全扫）。
 */
import { join } from 'node:path'
import { dotDir } from '../../platform/persistence/paths'
import type { AgentClient, Capability, SessionLogReader } from '../shared/session-log-reader'
import type { UsageFileCursorStore } from '../shared/usage-file-cursor-store'
import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'
import { UsageRecord } from '../../contexts/usage/domain/usage-record'
import {
  collectMatchingFilesAsync,
  fileMtimeMsAsync,
  isJsonlFile,
  parseRfc3339Timestamp,
  rawHash,
  readJsonLinesAsync,
  sourcePathStr,
} from '../shared/file-utils'

class CodexSessionLogReader implements SessionLogReader {
  private readonly logsRoot: string

  constructor(private readonly cursors?: UsageFileCursorStore) {
    this.logsRoot = dotDir('codex')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const sessionsDir = join(this.logsRoot, 'sessions')
    const archivedDir = join(this.logsRoot, 'archived_sessions')

    const files: string[] = []
    files.push(...(await collectMatchingFilesAsync(sessionsDir, true, isJsonlFile)))
    files.push(...(await collectMatchingFilesAsync(archivedDir, false, isJsonlFile)))
    files.sort()

    const known = this.cursors ? await this.cursors.load('codex') : new Map<string, number>()
    const records: UsageRecord[] = []
    const processedFiles: Array<{ sourcePath: string; mtimeMs: number }> = []

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const filePath = files[fileIdx]
      const mtimeMs = await fileMtimeMsAsync(filePath)
      // 增量：mtime 未变 → 跳过（记录已在库）。历史 codex 文件量大，这是关键的性能护栏。
      if (mtimeMs !== 0 && known.get(filePath) === mtimeMs) continue

      try {
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
            : Math.floor(mtimeMs / 1000)

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
              rawUpdatedAt: Math.floor(mtimeMs / 1000),
              rawHash: rawHash(raw),
            }),
          )
        }
        // 解析成功 → 记录游标（同步服务在 upsert 成功后才持久化）。
        if (mtimeMs !== 0) processedFiles.push({ sourcePath: filePath, mtimeMs })
      } catch {
        // 单个文件读取/解析失败（超大文件超出 V8 字符串上限、权限、损坏行）不应让整个
        // codex 同步抛错归零。跳过该文件（不推进游标，下次重试），继续。
      }

      // Yield to the event loop every 16 files to avoid blocking the Electron main process
      if ((fileIdx + 1) % 16 === 0) {
        await new Promise((r) => setImmediate(r))
      }
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 }, processedFiles }
  }
}

export class CodexAgentClient implements AgentClient {
  private readonly reader: CodexSessionLogReader

  constructor(cursors?: UsageFileCursorStore) {
    this.reader = new CodexSessionLogReader(cursors)
  }

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
