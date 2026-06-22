/**
 * Claude adapter — reads ~/.claude/projects/[**]/*.jsonl (含子 agent 的 subagents/*.jsonl)
 *
 * 口径对齐 cc-switch services/session_usage.rs：
 *  - 一次真实 API 调用在 transcript 里会写成多条相同 message.id 的行
 *    (thinking/text/tool_use 各刷一次)，按行入库会重复计量。
 *  - 因此按 message.id 去重：优先保留有 stop_reason 的帧，同状态取 output_tokens 更大的；
 *    最终只导入「有 stop_reason 且 output_tokens>0」的条目（= 一次完整 API 调用）。
 *  - source_event_id 用 message.id（跨同步稳定，幂等 upsert），不再用 文件:行号。
 *
 * 增量：注入 UsageFileCursorStore 后，mtime 未变的文件直接跳过（其记录已在库）。
 * 本轮处理过的文件经 processedFiles 返回，由同步服务在 upsert 成功后推进游标。
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
  readJsonLinesIter,
  sourcePathStr,
} from '../shared/file-utils'

/** 单条 assistant usage 帧（去重前）。 */
interface AssistantFrame {
  raw: string
  model: string
  sessionId: string | undefined
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  stopReason: string | null
  tsStr: string | undefined
}

class ClaudeSessionLogReader implements SessionLogReader {
  private readonly logsRoot: string

  constructor(private readonly cursors?: UsageFileCursorStore) {
    this.logsRoot = join(dotDir('claude'), 'projects')
  }

  async readUsageMetrics(_cursor: UsageCursor | null): Promise<UsageMetricsBatch> {
    const files = await collectMatchingFilesAsync(this.logsRoot, true, isJsonlFile)
    const known = this.cursors ? await this.cursors.load('claude') : new Map<string, number>()
    const records: UsageRecord[] = []
    const processedFiles: Array<{ sourcePath: string; mtimeMs: number }> = []

    let processed = 0
    for (const filePath of files) {
      const mtimeMs = await fileMtimeMsAsync(filePath)
      // 增量：mtime 未变 → 跳过（记录已在 usage_records）。
      if (mtimeMs !== 0 && known.get(filePath) === mtimeMs) continue

      try {
        // 流式逐行读：避免把整个 transcript 读进单个字符串（超大会话文件防 OOM/超字符串上限）。
        // 单文件内按 message.id 去重（对齐 cc-switch sync_single_file 的 per-file HashMap）。
        const byMsgId = new Map<string, AssistantFrame>()
        for await (const [, raw] of readJsonLinesIter(filePath)) {
          let value: Record<string, any>
          try {
            value = JSON.parse(raw)
          } catch {
            continue
          }
          if (value?.type !== 'assistant') continue
          const message = value?.message
          const msgId: string | undefined = message?.id
          if (!msgId) continue
          const usage = message?.usage
          if (!hasUsageTokens(usage)) continue

          const frame: AssistantFrame = {
            raw,
            model: message?.model ?? 'unknown-model',
            sessionId: value?.sessionId ?? undefined,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
            stopReason: message?.stop_reason ?? null,
            tsStr: value?.timestamp,
          }
          if (shouldReplace(frame, byMsgId.get(msgId))) byMsgId.set(msgId, frame)
        }

        // 对齐 cc-switch：任一计费维度 >0 即导入，不再强求 stop_reason 和 output>0。
        // Anthropic 在受理请求时即对 input + cache_read + cache_creation 计费；
        // Workflow / 子 agent 的并行短命请求经常只写了 message_start 快照（output=1、
        // stop_reason=None），但 cache/input 成本已被真实计费。旧的双重过滤会把
        // 这类请求整条丢弃，实测系统性低估约 4.1%，92% 集中在 workflow/subagent。
        // request_id = session:msg_id 主键 + INSERT OR IGNORE 保证一个 message 仍只落库一次。
        const fileMtimeSec = Math.floor(mtimeMs / 1000)
        for (const [msgId, f] of byMsgId) {
          const hasBillable =
            f.inputTokens > 0 || f.outputTokens > 0 ||
            f.cacheReadTokens > 0 || f.cacheCreationTokens > 0
          if (!hasBillable) continue
          const occurredAt = f.tsStr ? parseRfc3339Timestamp(f.tsStr) : fileMtimeSec
          records.push(
            UsageRecord.create({
              agentId: 'claude',
              sourceKind: 'session',
              sourcePath: sourcePathStr(filePath),
              sourceEventId: msgId,
              sessionId: f.sessionId,
              model: f.model,
              providerName: 'anthropic',
              inputTokens: f.inputTokens,
              outputTokens: f.outputTokens,
              cacheReadTokens: f.cacheReadTokens,
              cacheCreationTokens: f.cacheCreationTokens,
              occurredAt,
              rawUpdatedAt: fileMtimeSec,
              rawHash: rawHash(f.raw),
            }),
          )
        }
        // 解析成功 → 记录游标（同步服务在 upsert 成功后才持久化）。
        if (mtimeMs !== 0) processedFiles.push({ sourcePath: filePath, mtimeMs })
      } catch {
        // 单个文件读取/解析失败（超大文件、权限、损坏行）不应让整个 claude 同步失败。
        // 跳过该文件（不推进游标，下次重试），继续扫描其余文件。
      }
      if (++processed % 16 === 0) await new Promise((r) => setImmediate(r))
    }

    return { records, nextCursor: { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 }, processedFiles }
  }
}

/**
 * 去重择优：mirrors cc-switch session_usage.rs:267-281。
 *  - 无旧帧 → 用新帧
 *  - 新帧有 stop_reason 而旧帧没有 → 替换
 *  - 两者 stop_reason 有无相同 → 取 output_tokens 更大的
 *  - 否则（旧有 stop_reason、新没有）→ 保留旧帧
 */
function shouldReplace(frame: AssistantFrame, existing: AssistantFrame | undefined): boolean {
  if (!existing) return true
  if (frame.stopReason !== null && existing.stopReason === null) return true
  if ((frame.stopReason !== null) === (existing.stopReason !== null)) {
    return frame.outputTokens > existing.outputTokens
  }
  return false
}

function hasUsageTokens(usage: any): boolean {
  if (!usage || typeof usage !== 'object') return false
  return ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].some(
    (f) => typeof usage[f] === 'number',
  )
}

export class ClaudeAgentClient implements AgentClient {
  private readonly reader: ClaudeSessionLogReader

  constructor(cursors?: UsageFileCursorStore) {
    this.reader = new ClaudeSessionLogReader(cursors)
  }

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
