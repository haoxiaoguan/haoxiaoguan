/**
 * Kiro adapter — reads ~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/dev_data/tokens_generated.jsonl
 * Fields: promptTokens, generatedTokens, model, timestamp, sessionId. No cache tokens.
 * Mirrors Rust KiroAdapter.read_usage_metrics
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { appSupportDir } from '../../platform/persistence/paths'
import type { AgentClient, Capability, SessionLogReader } from '../shared/session-log-reader'
import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'
import { UsageRecord } from '../../contexts/usage/domain/usage-record'
import {
  fileUpdatedAt,
  parseRfc3339Timestamp,
  rawHash,
  readJsonLines,
  sourcePathStr,
} from '../shared/file-utils'

class KiroSessionLogReader implements SessionLogReader {
  private get logPath(): string {
    return join(
      appSupportDir('Kiro'),
      'User',
      'globalStorage',
      'kiro.kiroagent',
      'dev_data',
      'tokens_generated.jsonl',
    )
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const filePath = this.logPath
    if (!existsSync(filePath)) {
      return { records: [], nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 } }
    }

    const lines = readJsonLines(filePath)
    const records: UsageRecord[] = []
    const fallbackTimestamp = fileUpdatedAt(filePath, 0)

    for (const [index, raw] of lines) {
      let value: Record<string, any>
      try {
        value = JSON.parse(raw)
      } catch {
        continue
      }
      const tsStr: string | undefined = value?.timestamp
      const occurredAt = tsStr ? parseRfc3339Timestamp(tsStr) : fallbackTimestamp

      records.push(
        UsageRecord.create({
          agentId: 'kiro',
          sourceKind: 'session',
          sourcePath: sourcePathStr(filePath),
          sourceEventId: `kiro-${index}`,
          sessionId: value?.sessionId ?? undefined,
          model: value?.model ?? 'unknown-model',
          providerName: 'kiro',
          inputTokens: value?.promptTokens ?? 0,
          outputTokens: value?.generatedTokens ?? 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          occurredAt,
          rawUpdatedAt: fileUpdatedAt(filePath, occurredAt),
          rawHash: rawHash(raw),
        }),
      )
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 } }
  }
}

export class KiroAgentClient implements AgentClient {
  private readonly reader = new KiroSessionLogReader()

  id(): string {
    return 'kiro'
  }

  capabilities(): Capability[] {
    return ['credential', 'session_log']
  }

  asSessionLogReader(): SessionLogReader | null {
    return this.reader
  }
}
