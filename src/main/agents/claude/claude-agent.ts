/**
 * Claude adapter — reads ~/.claude/projects/[**]/*.jsonl
 * Mirrors Rust ClaudeAdapter.read_usage_metrics
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

class ClaudeSessionLogReader implements SessionLogReader {
  private readonly logsRoot: string

  constructor() {
    this.logsRoot = join(dotDir('claude'), 'projects')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await collectMatchingFilesAsync(this.logsRoot, true, isJsonlFile)
    const records: UsageRecord[] = []

    let _i = 0
    for (const filePath of files) {
      const lines = await readJsonLinesAsync(filePath)
      for (const [index, raw] of lines) {
        let value: Record<string, any>
        try {
          value = JSON.parse(raw)
        } catch {
          continue
        }
        const usage = value?.message?.usage
        if (!hasUsageTokens(usage)) continue

        const tsStr: string | undefined = value?.timestamp
        const occurredAt = tsStr ? parseRfc3339Timestamp(tsStr) : await fileUpdatedAtAsync(filePath, 0)

        records.push(
          UsageRecord.create({
            agentId: 'claude',
            sourceKind: 'session',
            sourcePath: sourcePathStr(filePath),
            sourceEventId: `${filePath}:${index}`,
            sessionId: value?.sessionId ?? undefined,
            model: value?.message?.model ?? 'unknown-model',
            providerName: 'anthropic',
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
            occurredAt,
            rawUpdatedAt: await fileUpdatedAtAsync(filePath, occurredAt),
            rawHash: rawHash(raw),
          }),
        )
      }
      if (++_i % 16 === 0) await new Promise((r) => setImmediate(r))
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 } }
  }
}

function hasUsageTokens(usage: any): boolean {
  if (!usage || typeof usage !== 'object') return false
  return ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some(
    (f) => typeof usage[f] === 'number',
  )
}

export class ClaudeAgentClient implements AgentClient {
  private readonly reader = new ClaudeSessionLogReader()

  id(): string {
    return 'claude'
  }

  capabilities(): Capability[] {
    return ['skills', 'mcp', 'session_log']
  }

  asSessionLogReader(): SessionLogReader | null {
    return this.reader
  }
}
