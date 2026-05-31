/**
 * Qoder adapter — reads ~/Library/Application Support/Qoder/SharedClientCache/cli/projects/[**]/task-*.session.execution-session.json
 * Each file is a single JSON object. Fields: prompt_tokens, completion_tokens, model, timestamp, session_id, id.
 * No cache tokens.
 * Mirrors Rust QoderAdapter.read_usage_metrics
 */
import { join } from 'node:path'
import { appSupportDir } from '../../platform/persistence/paths'
import type { AgentClient, Capability, SessionLogReader } from '../shared/session-log-reader'
import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'
import { UsageRecord } from '../../contexts/usage/domain/usage-record'
import {
  collectMatchingFiles,
  fileUpdatedAt,
  parseRfc3339Timestamp,
  rawHash,
  readText,
  sourcePathStr,
} from '../shared/file-utils'

function isQoderSessionFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? ''
  return name.startsWith('task-') && name.endsWith('.session.execution-session.json')
}

class QoderSessionLogReader implements SessionLogReader {
  private get logsRoot(): string {
    return join(appSupportDir('Qoder'), 'SharedClientCache', 'cli', 'projects')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = collectMatchingFiles(this.logsRoot, true, isQoderSessionFile)
    const records: UsageRecord[] = []

    for (const filePath of files) {
      let raw: string
      try {
        raw = readText(filePath)
      } catch {
        continue
      }
      let value: Record<string, any>
      try {
        value = JSON.parse(raw)
      } catch {
        continue
      }
      const tsStr: string | undefined = value?.timestamp
      const occurredAt = tsStr ? parseRfc3339Timestamp(tsStr) : fileUpdatedAt(filePath, 0)

      records.push(
        UsageRecord.create({
          agentId: 'qoder',
          sourceKind: 'session',
          sourcePath: sourcePathStr(filePath),
          sourceEventId: value?.id ?? 'qoder-event',
          sessionId: value?.session_id ?? undefined,
          model: value?.model ?? 'unknown-model',
          providerName: 'qoder',
          inputTokens: value?.prompt_tokens ?? 0,
          outputTokens: value?.completion_tokens ?? 0,
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

export class QoderAgentClient implements AgentClient {
  private readonly reader = new QoderSessionLogReader()

  id(): string {
    return 'qoder'
  }

  capabilities(): Capability[] {
    return ['credential', 'session_log']
  }

  asSessionLogReader(): SessionLogReader | null {
    return this.reader
  }
}
