/**
 * Gemini CLI adapter — reads ~/.gemini/tmp/session-*.json (recursive)
 * Each file is a single JSON object with an events[] array.
 * output_tokens = tokens.output + tokens.thoughts
 * Mirrors Rust GeminiCliAdapter.read_usage_metrics
 */
import { join } from 'node:path'
import { dotDir } from '../../platform/persistence/paths'
import type { AgentClient, Capability, SessionLogReader } from '../shared/session-log-reader'
import type { UsageMetricsBatch, UsageCursor } from '../../contexts/usage/domain/usage-record'
import { UsageRecord } from '../../contexts/usage/domain/usage-record'
import {
  collectMatchingFilesAsync,
  fileUpdatedAtAsync,
  parseRfc3339Timestamp,
  rawHash,
  readTextAsync,
  sourcePathStr,
} from '../shared/file-utils'

function isGeminiSessionFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? ''
  return name.startsWith('session-') && name.endsWith('.json')
}

class GeminiCliSessionLogReader implements SessionLogReader {
  private readonly logsRoot: string

  constructor() {
    this.logsRoot = join(dotDir('gemini'), 'tmp')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await collectMatchingFilesAsync(this.logsRoot, true, isGeminiSessionFile)
    const records: UsageRecord[] = []

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const filePath = files[fileIndex]
      let raw: string
      try {
        raw = await readTextAsync(filePath)
      } catch {
        continue
      }
      let value: Record<string, any>
      try {
        value = JSON.parse(raw)
      } catch {
        continue
      }
      const events: any[] = Array.isArray(value?.events) ? value.events : []

      for (let index = 0; index < events.length; index++) {
        const event = events[index]
        const tsStr: string | undefined = event?.timestamp
        const occurredAt = tsStr ? parseRfc3339Timestamp(tsStr) : await fileUpdatedAtAsync(filePath, 0)

        const outputTokens =
          (event?.tokens?.output ?? 0) + (event?.tokens?.thoughts ?? 0)

        records.push(
          UsageRecord.create({
            agentId: 'gemini-cli',
            sourceKind: 'session',
            sourcePath: sourcePathStr(filePath),
            sourceEventId: `${filePath}:${index}`,
            sessionId: event?.sessionId ?? undefined,
            model: event?.model ?? 'unknown-model',
            providerName: 'google',
            inputTokens: event?.tokens?.input ?? 0,
            outputTokens,
            cacheReadTokens: event?.tokens?.cached ?? 0,
            cacheCreationTokens: 0,
            occurredAt,
            rawUpdatedAt: await fileUpdatedAtAsync(filePath, occurredAt),
            rawHash: rawHash(raw),
          }),
        )
      }

      if ((fileIndex + 1) % 16 === 0) {
        await new Promise((r) => setImmediate(r))
      }
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 } }
  }
}

export class GeminiCliAgentClient implements AgentClient {
  private readonly reader = new GeminiCliSessionLogReader()

  id(): string {
    return 'gemini-cli'
  }

  capabilities(): Capability[] {
    return ['credential', 'skills', 'mcp', 'session_log']
  }

  asSessionLogReader(): SessionLogReader | null {
    return this.reader
  }
}
