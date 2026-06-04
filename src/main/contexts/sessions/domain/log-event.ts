// 会话日志中的中性事件 —— 供 activity 上下文消费（依赖方向 activity→sessions）。
// tool 用开放 string、kind 可扩展：接新 agent / 新指标都不改这里的消费方。
export type RawLogEventKind = 'session' | 'tool_call' | 'code_edit'

export interface RawLogEvent {
  /** 开放字符串（'claude'|'codex'|'gemini'|未来的新 agent） */
  tool: string
  kind: RawLogEventKind
  /** epoch 毫秒，用于按日分桶（无可靠时间戳的事件不应产出） */
  ts: number
  /** 全局稳定去重键：session=文件路径；tool_call=记录 uuid/call_id 派生 */
  sourceKey: string
  /** tool_call 的工具名（统计用，可空） */
  name?: string
  /** 求和量（缺省视为 1）：code_edit 携带改动行数 churn；session/tool_call 不带 */
  amount?: number
}

export interface ActivityCollectResult {
  events: RawLogEvent[]
  /** 本次扫描见到的最大文件 mtime（毫秒），用于推进增量 watermark */
  latestMtime: number
}
